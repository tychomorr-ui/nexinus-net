import { describe, expect, it } from "vitest";
import { billingStore, BILLING_QUOTA_BY_TIER } from "./billingStore";

describe("billingStore", () => {
  it("persists free-trial flags and trial end timestamps across profile reads", async () => {
    const userId = `trial-${Date.now()}`;
    const trialEndsAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    await billingStore.upsertProfile({
      userId,
      email: "trial@nexinus.net",
      freeTrialUsed: true,
      trialEndsAt,
    });

    const profile = await billingStore.getProfile(userId);

    expect(profile.userId).toBe(userId);
    expect(profile.freeTrialUsed).toBe(true);
    expect(profile.trialEndsAt).toBe(trialEndsAt);
  });

  it("applies the selected tier quota and tracks subsequent quota consumption", async () => {
    const userId = `quota-${Date.now()}`;

    const upgraded = await billingStore.applyTier(userId, "omniapi", {
      freeTrialUsed: true,
      stripeSubscriptionId: "sub_test_omniapi",
    });

    expect(upgraded.accessTier).toBe("omniapi");
    expect(upgraded.queryQuotaRemaining).toBe(BILLING_QUOTA_BY_TIER.omniapi);

    const consumption = await billingStore.consumeQuota(userId, 25);

    expect(consumption.ok).toBe(true);
    expect(consumption.profile.queryQuotaRemaining).toBe(
      BILLING_QUOTA_BY_TIER.omniapi - 25,
    );
  });
});
