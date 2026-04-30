import express from "express";
import Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { billingStore, type BillingAccessTier } from "./billingStore";
import { getProductPlan, PRODUCT_PLANS } from "./products";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
const DEFAULT_SUCCESS_PATH = "/?billing=success";
const DEFAULT_CANCEL_PATH = "/?billing=cancelled";
const DEFAULT_FREE_TRIAL_DAYS = Number(process.env.XINUS_FREE_TRIAL_DAYS ?? 7);
const CANONICAL_ORIGIN = "https://nexinus.net";

function getStripeClient() {
  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe is not configured" });
  }

  return new Stripe(apiKey);
}

function resolveOrigin(originHeader?: string | null) {
  if (!originHeader) return CANONICAL_ORIGIN;
  try {
    const parsed = new URL(originHeader);
    if (parsed.hostname === "nexinus.net" || parsed.hostname === "www.nexinus.net" || parsed.hostname.endsWith("manus.computer")) {
      return parsed.origin;
    }
  } catch {
    return CANONICAL_ORIGIN;
  }
  return CANONICAL_ORIGIN;
}

function normalizeTierFromMetadata(rawTier?: string | null): BillingAccessTier {
  if (rawTier === "sovereign" || rawTier === "omniapi") {
    return rawTier;
  }
  return "mirror";
}

type StripeInvoiceWithLegacySubscription = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

function extractSubscriptionPriceId(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.price?.id ?? null;
}

function extractInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const legacySubscription = (invoice as StripeInvoiceWithLegacySubscription).subscription;
  return typeof legacySubscription === "string" ? legacySubscription : legacySubscription?.id ?? null;
}

function extractTierFromSubscription(subscription: Stripe.Subscription) {
  const metadataTier = normalizeTierFromMetadata(subscription.metadata?.tier);
  if (subscription.metadata?.tier) return metadataTier;

  const priceLookup = subscription.items.data[0]?.price?.lookup_key;
  if (priceLookup === "sovereign" || priceLookup === "omniapi") {
    return priceLookup;
  }
  return "mirror";
}

async function reconcileSubscription(params: {
  userId: string;
  eventType: string;
  eventId: string;
  stripeCustomerId: string | null;
  stripeSubscription: Stripe.Subscription;
}) {
  const tier = extractTierFromSubscription(params.stripeSubscription);
  const profile = await billingStore.applyTier(params.userId, tier, {
    stripeCustomerId: params.stripeCustomerId,
    stripeSubscriptionId: params.stripeSubscription.id,
    stripePriceId: extractSubscriptionPriceId(params.stripeSubscription),
    freeTrialUsed: true,
    trialEndsAt: params.stripeSubscription.trial_end ? params.stripeSubscription.trial_end * 1000 : null,
  });

  await billingStore.logAudit({
    userId: params.userId,
    eventType: params.eventType,
    eventId: params.eventId,
    stripeCustomerId: profile.stripeCustomerId,
    stripeSubscriptionId: profile.stripeSubscriptionId,
    stripePaymentIntentId: profile.stripePaymentIntentId,
    stripeInvoiceId: profile.stripeInvoiceId,
    accessTier: profile.accessTier,
    queryQuotaRemaining: profile.queryQuotaRemaining,
  });

  return profile;
}

async function reconcilePaymentIntent(params: {
  userId: string;
  eventType: string;
  eventId: string;
  paymentIntent: Stripe.PaymentIntent;
}) {
  const current = await billingStore.getProfile(params.userId);
  const profile = await billingStore.upsertProfile({
    userId: params.userId,
    stripeCustomerId: typeof params.paymentIntent.customer === "string" ? params.paymentIntent.customer : params.paymentIntent.customer?.id ?? current.stripeCustomerId,
    stripePaymentIntentId: params.paymentIntent.id,
  });

  await billingStore.logAudit({
    userId: params.userId,
    eventType: params.eventType,
    eventId: params.eventId,
    stripeCustomerId: profile.stripeCustomerId,
    stripeSubscriptionId: profile.stripeSubscriptionId,
    stripePaymentIntentId: profile.stripePaymentIntentId,
    stripeInvoiceId: profile.stripeInvoiceId,
    accessTier: profile.accessTier,
    queryQuotaRemaining: profile.queryQuotaRemaining,
  });
}

async function reconcileInvoice(params: {
  userId: string;
  eventType: string;
  eventId: string;
  invoice: Stripe.Invoice;
}) {
  const current = await billingStore.getProfile(params.userId);
  const profile = await billingStore.upsertProfile({
    userId: params.userId,
    stripeCustomerId: typeof params.invoice.customer === "string" ? params.invoice.customer : params.invoice.customer?.id ?? current.stripeCustomerId,
    stripeSubscriptionId: extractInvoiceSubscriptionId(params.invoice) ?? current.stripeSubscriptionId,
    stripeInvoiceId: params.invoice.id,
  });

  await billingStore.logAudit({
    userId: params.userId,
    eventType: params.eventType,
    eventId: params.eventId,
    stripeCustomerId: profile.stripeCustomerId,
    stripeSubscriptionId: profile.stripeSubscriptionId,
    stripePaymentIntentId: profile.stripePaymentIntentId,
    stripeInvoiceId: profile.stripeInvoiceId,
    accessTier: profile.accessTier,
    queryQuotaRemaining: profile.queryQuotaRemaining,
  });
}

export const billingRouter = router({
  plans: publicProcedure.query(() => {
    return Object.values(PRODUCT_PLANS).map(plan => ({
      ...plan,
      freeTrialDays: DEFAULT_FREE_TRIAL_DAYS,
    }));
  }),

  status: protectedProcedure.query(async ({ ctx }) => {
    return billingStore.getProfile(String(ctx.user.id));
  }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return billingStore.listAudit(String(ctx.user.id));
  }),

  createCheckout: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["mirror", "sovereign", "omniapi"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripeClient();
      const plan = getProductPlan(input.tier);
      const origin = resolveOrigin(ctx.req.headers.origin);
      const userId = String(ctx.user.id);
      const profile = await billingStore.getProfile(userId);
      const customerEmail = ctx.user.email ?? undefined;
      const customerName = ctx.user.name ?? undefined;
      const useFreeTrial = !profile.freeTrialUsed && !profile.stripeSubscriptionId;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        allow_promotion_codes: true,
        success_url: `${origin}${DEFAULT_SUCCESS_PATH}`,
        cancel_url: `${origin}${DEFAULT_CANCEL_PATH}`,
        customer: profile.stripeCustomerId ?? undefined,
        customer_email: profile.stripeCustomerId ? undefined : customerEmail,
        client_reference_id: userId,
        metadata: {
          user_id: userId,
          customer_email: customerEmail ?? "",
          customer_name: customerName ?? "",
          tier: plan.code,
        },
        subscription_data: {
          metadata: {
            user_id: userId,
            tier: plan.code,
          },
          trial_period_days: useFreeTrial ? DEFAULT_FREE_TRIAL_DAYS : undefined,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: plan.amountUsdCents,
              recurring: {
                interval: plan.interval,
              },
              product_data: {
                name: plan.name,
                description: plan.description,
              },
            },
          },
        ],
      });

      await billingStore.upsertProfile({
        userId,
        email: ctx.user.email ?? null,
        name: ctx.user.name ?? null,
        stripeCustomerId: profile.stripeCustomerId,
        accessTier: profile.accessTier,
      });

      return {
        checkoutUrl: session.url,
        freeTrialDays: useFreeTrial ? DEFAULT_FREE_TRIAL_DAYS : 0,
      };
    }),

  createBillingPortal: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripeClient();
    const profile = await billingStore.getProfile(String(ctx.user.id));
    const origin = resolveOrigin(ctx.req.headers.origin);

    if (!profile.stripeCustomerId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No Stripe customer is available yet" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${origin}/?billing=portal`,
    });

    return {
      portalUrl: session.url,
    };
  }),
});

export function registerStripeWebhook(app: express.Express) {
  app.post(STRIPE_WEBHOOK_PATH, express.raw({ type: "application/json" }), async (req, res) => {
    const stripe = getStripeClient();
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (!signature || !webhookSecret) {
      res.status(400).json({ ok: false, error: "Stripe webhook is not configured" });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "Invalid Stripe signature" });
      return;
    }

    if (event.id.startsWith("evt_test_")) {
      console.log("[Webhook] Test event detected, returning verification response");
      return res.json({
        verified: true,
      });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id ?? session.client_reference_id ?? "";
        if (userId) {
          const tier = normalizeTierFromMetadata(session.metadata?.tier);
          const profile = await billingStore.applyTier(userId, tier, {
            email: session.customer_details?.email ?? null,
            stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
            stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null,
            freeTrialUsed: true,
          });
          await billingStore.logAudit({
            userId,
            eventType: event.type,
            eventId: event.id,
            stripeCustomerId: profile.stripeCustomerId,
            stripeSubscriptionId: profile.stripeSubscriptionId,
            stripePaymentIntentId: profile.stripePaymentIntentId,
            stripeInvoiceId: profile.stripeInvoiceId,
            accessTier: profile.accessTier,
            queryQuotaRemaining: profile.queryQuotaRemaining,
          });
        }
      }

      if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.user_id;
        if (userId) {
          await reconcileSubscription({
            userId,
            eventType: event.type,
            eventId: event.id,
            stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
            stripeSubscription: subscription,
          });
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        const existing = subscription.metadata?.user_id
          ? await billingStore.getProfile(subscription.metadata.user_id)
          : await billingStore.getProfileByStripeSubscriptionId(subscription.id);
        if (existing) {
          const profile = await billingStore.applyTier(existing.userId, "mirror", {
            stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
            stripeSubscriptionId: subscription.id,
            stripePriceId: extractSubscriptionPriceId(subscription),
            trialEndsAt: null,
          });
          await billingStore.logAudit({
            userId: profile.userId,
            eventType: event.type,
            eventId: event.id,
            stripeCustomerId: profile.stripeCustomerId,
            stripeSubscriptionId: profile.stripeSubscriptionId,
            stripePaymentIntentId: profile.stripePaymentIntentId,
            stripeInvoiceId: profile.stripeInvoiceId,
            accessTier: profile.accessTier,
            queryQuotaRemaining: profile.queryQuotaRemaining,
          });
        }
      }

      if (event.type === "invoice.paid") {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = extractInvoiceSubscriptionId(invoice);
        const profile = subscriptionId
          ? await billingStore.getProfileByStripeSubscriptionId(subscriptionId)
          : null;
        if (profile) {
          await reconcileInvoice({
            userId: profile.userId,
            eventType: event.type,
            eventId: event.id,
            invoice,
          });
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const customerId = typeof paymentIntent.customer === "string" ? paymentIntent.customer : paymentIntent.customer?.id ?? null;
        const profile = customerId ? await billingStore.getProfileByStripeCustomerId(customerId) : null;
        if (profile) {
          await reconcilePaymentIntent({
            userId: profile.userId,
            eventType: event.type,
            eventId: event.id,
            paymentIntent,
          });
        }
      }

      if (event.type === "customer.created") {
        const customer = event.data.object as Stripe.Customer;
        const userId = customer.metadata?.user_id;
        if (userId) {
          const current = await billingStore.getProfile(userId);
          const profile = await billingStore.upsertProfile({
            userId,
            email: typeof customer.email === "string" ? customer.email : current.email,
            name: typeof customer.name === "string" ? customer.name : current.name,
            stripeCustomerId: customer.id,
          });
          await billingStore.logAudit({
            userId,
            eventType: event.type,
            eventId: event.id,
            stripeCustomerId: profile.stripeCustomerId,
            stripeSubscriptionId: profile.stripeSubscriptionId,
            stripePaymentIntentId: profile.stripePaymentIntentId,
            stripeInvoiceId: profile.stripeInvoiceId,
            accessTier: profile.accessTier,
            queryQuotaRemaining: profile.queryQuotaRemaining,
          });
        }
      }

      res.json({ received: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Webhook handling failed" });
    }
  });
}
