import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { billingStore } from "./billingStore";
import { sdk } from "./_core/sdk";
import { applyStrictCors } from "./_core/index";
import { registerXinusRoutes, xinusStore } from "./xinus";

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  applyStrictCors(app);
  app.use(express.json());
  registerXinusRoutes(app);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
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

describe("NEXINUS sovereign backend", () => {
  it("returns runtime health with engine metadata", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.ok).toBe(true);

    const payload = (await response.json()) as {
      ok: boolean;
      runtime: string;
      engineVersion: string;
      canonicalDomain: string;
      database: { connected: boolean; mode: string; ok: boolean };
    };
    expect(payload.ok).toBe(true);
    expect(payload.runtime).toBe("nexinus-sovereign-truth-engine");
    expect(payload.engineVersion).toBeTruthy();
    expect(payload.canonicalDomain).toBe("NEXINUS.net");
    expect(["memory", "postgres"]).toContain(payload.database.mode);
    expect(typeof payload.database.connected).toBe("boolean");
    expect(payload.database.ok).toBe(payload.database.connected);
  });

  it("rejects disallowed origins on the canonical API surface", async () => {
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: {
        Origin: "https://evil.example",
      },
    });

    expect(response.status).toBe(403);
    const payload = (await response.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Origin forbidden");
  });

  it("blocks Omni clarity requests without the exact owner header", async () => {
    const response = await fetch(`${baseUrl}/api/xinus/clarity?query=test&mode=Omni`);
    expect(response.status).toBe(403);

    const payload = (await response.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("XINUS_OWNER_KEY");
  });

  it("streams SSE clarity events for public bridge modes", async () => {
    const response = await fetch(`${baseUrl}/api/xinus/clarity?query=truth%20engine&mode=Transcend`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: state");
    expect(body).toContain("event: bridgeField");
    expect(body).toContain("event: identiSignal");
    expect(body).toContain("event: content");
    expect(body).toContain("event: mirror");
    expect(body).toContain("predictive-pressure-layer");
    expect(body).toContain("event: done");
  });

  it("enforces authenticated billing quota on the live clarity endpoint", async () => {
    const authSpy = vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({
      id: 501,
      openId: "quota-user",
      email: "quota@example.com",
      name: "Quota User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    await billingStore.upsertProfile({
      userId: "501",
      accessTier: "mirror",
      queryQuotaRemaining: 0,
      freeTrialUsed: true,
      trialEndsAt: null,
    });

    const response = await fetch(`${baseUrl}/api/xinus/clarity?query=quota&mode=Transcend`);
    expect(response.status).toBe(429);

    const payload = (await response.json()) as {
      ok: boolean;
      error: string;
      accessTier: string;
      queryQuotaRemaining: number;
    };

    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("quota exhausted");
    expect(payload.accessTier).toBe("mirror");
    expect(payload.queryQuotaRemaining).toBe(0);

    authSpy.mockRestore();
  });

  it("allows active free-trial users to reach paid bridge modes", async () => {
    process.env.XINUS_OWNER_KEY = "owner-trial-test";
    const authSpy = vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({
      id: 502,
      openId: "trial-user",
      email: "trial@example.com",
      name: "Trial User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });

    await billingStore.upsertProfile({
      userId: "502",
      accessTier: "mirror",
      queryQuotaRemaining: 3,
      freeTrialUsed: true,
      trialEndsAt: Date.now() + 60_000,
    });

    const response = await fetch(`${baseUrl}/api/xinus/clarity?query=trial&mode=Archangel`, {
      headers: {
        Cookie: "app_session_id=mock",
      },
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    expect(body).toContain("event: done");

    authSpy.mockRestore();
  });

  it("holds the previous bridge state across repeated trajectories unless strong confusion appears", async () => {
    const firstResponse = await fetch(`${baseUrl}/api/xinus/clarity?query=okay%20okay%20okay&mode=Light%20Warrior`);
    expect(firstResponse.ok).toBe(true);
    const firstBody = await firstResponse.text();
    const firstSessionId = firstBody.match(/"sessionId":"([^"]+)"/)?.[1];
    expect(firstSessionId).toBeTruthy();

    const repeatedResponse = await fetch(
      `${baseUrl}/api/xinus/clarity?query=okay%20okay%20okay&mode=Respond&sessionId=${firstSessionId}`,
    );
    expect(repeatedResponse.ok).toBe(true);
    const repeatedBody = await repeatedResponse.text();
    expect(repeatedBody).toContain('"mode":"Light Warrior"');
    expect(repeatedBody).toContain('"requestedMode":"Respond"');
    expect(repeatedBody).toContain('"trajectoryHeld":true');
  });

  it("only de-escalates when strong confusion signals are present", async () => {
    const firstResponse = await fetch(`${baseUrl}/api/xinus/clarity?query=act%20now&mode=Light%20Warrior`);
    expect(firstResponse.ok).toBe(true);
    const firstBody = await firstResponse.text();
    const firstSessionId = firstBody.match(/"sessionId":"([^"]+)"/)?.[1];
    expect(firstSessionId).toBeTruthy();

    const confusedResponse = await fetch(
      `${baseUrl}/api/xinus/clarity?query=why%20is%20this%20happening%3F%20I%20don't%20understand&mode=Respond&sessionId=${firstSessionId}`,
    );
    expect(confusedResponse.ok).toBe(true);
    const confusedBody = await confusedResponse.text();
    expect(confusedBody).toContain('"mode":"Respond"');
    expect(confusedBody).toContain('confusion-led-deescalation');
    expect(confusedBody).toContain('"confusionSignals":4');
  });

  it("preserves a verifiable mirror event ledger after seeding", async () => {
    const seedResult = await xinusStore.seedMirror(false, "test-owner");
    expect(seedResult.inserted + seedResult.alreadyPresent).toBeGreaterThan(0);

    const verification = await xinusStore.verifyLedger();
    expect(verification.ok).toBe(true);
    expect(verification.eventCount).toBeGreaterThan(0);
  });

  it("lists mirror registry tiers for the frontend registry route", async () => {
    await xinusStore.seedMirror(false, "test-owner");

    const response = await fetch(`${baseUrl}/api/xinus/mirror/registry`);
    expect(response.ok).toBe(true);

    const payload = (await response.json()) as {
      ok: boolean;
      tiers: Array<{ tier: number; rows: Array<{ tier: number; fullName: string }> }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.tiers.map(group => group.tier)).toEqual([100, 90, 80, 70, 40]);
    expect(payload.tiers.every(group => Array.isArray(group.rows))).toBe(true);
  });
});
