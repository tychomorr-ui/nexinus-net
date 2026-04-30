import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { billingStore } from "./billingStore";
import type { TrpcContext } from "./_core/context";

const stripeMocks = vi.hoisted(() => {
  return {
    checkoutCreate: vi.fn(async () => ({ url: "https://checkout.stripe.test/session_123" })),
    portalCreate: vi.fn(async () => ({ url: "https://billing.stripe.test/session_123" })),
    constructEvent: vi.fn(),
  };
});

vi.mock("stripe", () => {
  return {
    default: class StripeMock {
      checkout = {
        sessions: {
          create: stripeMocks.checkoutCreate,
        },
      };

      billingPortal = {
        sessions: {
          create: stripeMocks.portalCreate,
        },
      };

      webhooks = {
        constructEvent: stripeMocks.constructEvent,
      };
    },
  };
});

const { appRouter } = await import("./routers");
const { registerStripeWebhook } = await import("./stripeBilling");

function createProtectedContext(userId: number, origin = "https://nexinus.net") {
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user-${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {
        origin,
      },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return ctx;
}

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_nexinus";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_nexinus";

  const app = express();
  registerStripeWebhook(app);
  app.use(express.json());
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  stripeMocks.checkoutCreate.mockClear();
  stripeMocks.portalCreate.mockClear();
  stripeMocks.constructEvent.mockReset();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
});

describe("stripe billing router", () => {
  it("exposes sovereign plans with free-trial metadata", async () => {
    const caller = appRouter.createCaller(createProtectedContext(301));
    const plans = await caller.billing.plans();

    expect(plans.map(plan => plan.code)).toEqual(["mirror", "sovereign", "omniapi"]);
    expect(plans.every(plan => plan.freeTrialDays === 7)).toBe(true);
  });

  it("creates checkout sessions with canonical metadata and free-trial defaults", async () => {
    const caller = appRouter.createCaller(createProtectedContext(302, "https://nexinus.net"));

    const result = await caller.billing.createCheckout({ tier: "mirror" });

    expect(result.checkoutUrl).toBe("https://checkout.stripe.test/session_123");
    expect(result.freeTrialDays).toBe(7);
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1);
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        allow_promotion_codes: true,
        client_reference_id: "302",
        metadata: expect.objectContaining({
          user_id: "302",
          customer_email: "user-302@example.com",
          customer_name: "User 302",
          tier: "mirror",
        }),
        subscription_data: expect.objectContaining({
          trial_period_days: 7,
          metadata: expect.objectContaining({
            user_id: "302",
            tier: "mirror",
          }),
        }),
      }),
    );
  });

  it("creates billing portal sessions for existing Stripe customers", async () => {
    await billingStore.upsertProfile({
      userId: "303",
      stripeCustomerId: "cus_existing_303",
      email: "user-303@example.com",
      name: "User 303",
    });

    const caller = appRouter.createCaller(createProtectedContext(303, "https://nexinus.net"));
    const result = await caller.billing.createBillingPortal();

    expect(result.portalUrl).toBe("https://billing.stripe.test/session_123");
    expect(stripeMocks.portalCreate).toHaveBeenCalledWith({
      customer: "cus_existing_303",
      return_url: "https://nexinus.net/?billing=portal",
    });
  });
});

describe("stripe webhook", () => {
  it("returns the required verification payload for Stripe test events", async () => {
    stripeMocks.constructEvent.mockReturnValue({
      id: "evt_test_123",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    const response = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": "sig_test",
      },
      body: JSON.stringify({ test: true }),
    });

    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ verified: true });
    expect(stripeMocks.constructEvent).toHaveBeenCalledTimes(1);
  });
});
