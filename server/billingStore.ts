import { Pool } from "pg";

export type BillingAccessTier = "mirror" | "sovereign" | "omniapi";
export type BillingProfile = {
  userId: string;
  email: string | null;
  name: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripePriceId: string | null;
  accessTier: BillingAccessTier;
  queryQuotaRemaining: number;
  freeTrialUsed: boolean;
  trialEndsAt: number | null;
  updatedAt: number;
};

type BillingAuditRecord = {
  userId: string;
  eventType: string;
  eventId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  accessTier: BillingAccessTier;
  queryQuotaRemaining: number;
  createdAt: number;
};

type UpsertBillingProfileInput = {
  userId: string;
  email?: string | null;
  name?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeInvoiceId?: string | null;
  stripePriceId?: string | null;
  accessTier?: BillingAccessTier;
  queryQuotaRemaining?: number;
  freeTrialUsed?: boolean;
  trialEndsAt?: number | null;
};

const FALLBACK_QUOTA_BY_TIER: Record<BillingAccessTier, number> = {
  mirror: 25,
  sovereign: 500,
  omniapi: 5000,
};

class BillingStore {
  private readonly postgresUrl = process.env.XINUS_DATABASE_URL?.trim() || (process.env.DATABASE_URL?.startsWith("postgres") ? process.env.DATABASE_URL : "");
  private readonly pool = this.postgresUrl ? new Pool({ connectionString: this.postgresUrl }) : null;
  private readonly profiles = new Map<string, BillingProfile>();
  private readonly audit = new Map<string, BillingAuditRecord[]>();
  private mode: "postgres" | "memory" = this.pool ? "postgres" : "memory";
  private readyPromise: Promise<void> | null = null;
  private lastError: string | null = null;

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    await this.readyPromise;
  }

  private async initialize() {
    if (!this.pool) {
      this.mode = "memory";
      return;
    }

    try {
      await this.pool.query("select 1");
      await this.pool.query(`
        create table if not exists xinus_billing_profiles (
          id bigserial primary key,
          user_id text not null unique,
          email text,
          name text,
          stripe_customer_id text,
          stripe_subscription_id text,
          stripe_payment_intent_id text,
          stripe_invoice_id text,
          stripe_price_id text,
          access_tier text not null default 'mirror',
          query_quota_remaining integer not null default 25,
          free_trial_used boolean not null default false,
          trial_ends_at timestamptz,
          updated_at timestamptz not null default now()
        );

        alter table xinus_billing_profiles add column if not exists free_trial_used boolean not null default false;
        alter table xinus_billing_profiles add column if not exists trial_ends_at timestamptz;

        create table if not exists xinus_billing_audit (
          id bigserial primary key,
          user_id text not null,
          event_type text not null,
          event_id text not null,
          stripe_customer_id text,
          stripe_subscription_id text,
          stripe_payment_intent_id text,
          stripe_invoice_id text,
          access_tier text not null,
          query_quota_remaining integer not null,
          created_at timestamptz not null default now()
        );

        create index if not exists xinus_billing_audit_user_idx on xinus_billing_audit (user_id, created_at desc);
      `);
      this.mode = "postgres";
      this.lastError = null;
    } catch (error) {
      this.mode = "memory";
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[BillingStore] postgres unavailable, falling back to memory", error);
    }
  }

  async getMode() {
    await this.ensureReady();
    return { mode: this.mode, lastError: this.lastError };
  }

  private buildDefaultProfile(userId: string) {
    return {
      userId,
      email: null,
      name: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripePaymentIntentId: null,
      stripeInvoiceId: null,
      stripePriceId: null,
      accessTier: "mirror" as BillingAccessTier,
      queryQuotaRemaining: FALLBACK_QUOTA_BY_TIER.mirror,
      freeTrialUsed: false,
      trialEndsAt: null,
      updatedAt: Date.now(),
    } satisfies BillingProfile;
  }

  async getProfile(userId: string) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        user_id: string;
        email: string | null;
        name: string | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        stripe_payment_intent_id: string | null;
        stripe_invoice_id: string | null;
        stripe_price_id: string | null;
        access_tier: BillingAccessTier;
        query_quota_remaining: number;
        free_trial_used: boolean;
        trial_ends_at: Date | null;
        updated_at: Date;
      }>(
        `
          select user_id, email, name, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, stripe_price_id, access_tier, query_quota_remaining, free_trial_used, trial_ends_at, updated_at
          from xinus_billing_profiles
          where user_id = $1
          limit 1
        `,
        [userId],
      );

      const row = result.rows[0];
      if (!row) return this.buildDefaultProfile(userId);
      return {
        userId: row.user_id,
        email: row.email,
        name: row.name,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        stripeInvoiceId: row.stripe_invoice_id,
        stripePriceId: row.stripe_price_id,
        accessTier: row.access_tier,
        queryQuotaRemaining: row.query_quota_remaining,
        freeTrialUsed: row.free_trial_used,
        trialEndsAt: row.trial_ends_at?.getTime() ?? null,
        updatedAt: row.updated_at.getTime(),
      } satisfies BillingProfile;
    }

    return this.profiles.get(userId) ?? this.buildDefaultProfile(userId);

  }

  async getProfileByStripeCustomerId(stripeCustomerId: string) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        user_id: string;
        email: string | null;
        name: string | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        stripe_payment_intent_id: string | null;
        stripe_invoice_id: string | null;
        stripe_price_id: string | null;
        access_tier: BillingAccessTier;
        query_quota_remaining: number;
        free_trial_used: boolean;
        trial_ends_at: Date | null;
        updated_at: Date;
      }>(
        `
          select user_id, email, name, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, stripe_price_id, access_tier, query_quota_remaining, free_trial_used, trial_ends_at, updated_at
          from xinus_billing_profiles
          where stripe_customer_id = $1
          limit 1
        `,
        [stripeCustomerId],
      );

      const row = result.rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        email: row.email,
        name: row.name,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        stripeInvoiceId: row.stripe_invoice_id,
        stripePriceId: row.stripe_price_id,
        accessTier: row.access_tier,
        queryQuotaRemaining: row.query_quota_remaining,
        freeTrialUsed: row.free_trial_used,
        trialEndsAt: row.trial_ends_at?.getTime() ?? null,
        updatedAt: row.updated_at.getTime(),
      } satisfies BillingProfile;
    }

    return Array.from(this.profiles.values()).find(
      profile => profile.stripeCustomerId === stripeCustomerId,
    ) ?? null;
  }

  async getProfileByStripeSubscriptionId(stripeSubscriptionId: string) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        user_id: string;
        email: string | null;
        name: string | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        stripe_payment_intent_id: string | null;
        stripe_invoice_id: string | null;
        stripe_price_id: string | null;
        access_tier: BillingAccessTier;
        query_quota_remaining: number;
        free_trial_used: boolean;
        trial_ends_at: Date | null;
        updated_at: Date;
      }>(
        `
          select user_id, email, name, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, stripe_price_id, access_tier, query_quota_remaining, free_trial_used, trial_ends_at, updated_at
          from xinus_billing_profiles
          where stripe_subscription_id = $1
          limit 1
        `,
        [stripeSubscriptionId],
      );

      const row = result.rows[0];
      if (!row) return null;
      return {
        userId: row.user_id,
        email: row.email,
        name: row.name,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        stripeInvoiceId: row.stripe_invoice_id,
        stripePriceId: row.stripe_price_id,
        accessTier: row.access_tier,
        queryQuotaRemaining: row.query_quota_remaining,
        freeTrialUsed: row.free_trial_used,
        trialEndsAt: row.trial_ends_at?.getTime() ?? null,
        updatedAt: row.updated_at.getTime(),
      } satisfies BillingProfile;
    }

    return Array.from(this.profiles.values()).find(
      profile => profile.stripeSubscriptionId === stripeSubscriptionId,
    ) ?? null;
  }

  async upsertProfile(input: UpsertBillingProfileInput) {
    await this.ensureReady();
    const current = await this.getProfile(input.userId);
    const next: BillingProfile = {
      ...current,
      ...input,
      accessTier: input.accessTier ?? current.accessTier,
      queryQuotaRemaining: input.queryQuotaRemaining ?? current.queryQuotaRemaining,
      freeTrialUsed: input.freeTrialUsed ?? current.freeTrialUsed,
      trialEndsAt: input.trialEndsAt === undefined ? current.trialEndsAt : input.trialEndsAt,
      updatedAt: Date.now(),
    };

    if (this.mode === "postgres" && this.pool) {
      await this.pool.query(
        `
          insert into xinus_billing_profiles (
            user_id, email, name, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, stripe_price_id, access_tier, query_quota_remaining, free_trial_used, trial_ends_at, updated_at
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
          on conflict (user_id) do update set
            email = excluded.email,
            name = excluded.name,
            stripe_customer_id = excluded.stripe_customer_id,
            stripe_subscription_id = excluded.stripe_subscription_id,
            stripe_payment_intent_id = excluded.stripe_payment_intent_id,
            stripe_invoice_id = excluded.stripe_invoice_id,
            stripe_price_id = excluded.stripe_price_id,
            access_tier = excluded.access_tier,
            query_quota_remaining = excluded.query_quota_remaining,
            free_trial_used = excluded.free_trial_used,
            trial_ends_at = excluded.trial_ends_at,
            updated_at = now()
        `,
        [
          next.userId,
          next.email,
          next.name,
          next.stripeCustomerId,
          next.stripeSubscriptionId,
          next.stripePaymentIntentId,
          next.stripeInvoiceId,
          next.stripePriceId,
          next.accessTier,
          next.queryQuotaRemaining,
          next.freeTrialUsed,
          next.trialEndsAt ? new Date(next.trialEndsAt) : null,
        ],
      );
      return next;
    }

    this.profiles.set(next.userId, next);
    return next;
  }

  async applyTier(
    userId: string,
    tier: BillingAccessTier,
    identifiers: Omit<UpsertBillingProfileInput, "userId"> = {},
  ) {
    return this.upsertProfile({
      userId,
      ...identifiers,
      accessTier: tier,
      queryQuotaRemaining: FALLBACK_QUOTA_BY_TIER[tier],
    });
  }

  async consumeQuota(userId: string, amount: number = 1) {
    const current = await this.getProfile(userId);
    if (current.queryQuotaRemaining < amount) {
      return { ok: false, profile: current } as const;
    }

    const profile = await this.upsertProfile({
      userId,
      queryQuotaRemaining: current.queryQuotaRemaining - amount,
    });
    return { ok: true, profile } as const;
  }

  async logAudit(record: Omit<BillingAuditRecord, "createdAt">) {
    await this.ensureReady();
    const next: BillingAuditRecord = {
      ...record,
      createdAt: Date.now(),
    };

    if (this.mode === "postgres" && this.pool) {
      await this.pool.query(
        `
          insert into xinus_billing_audit (
            user_id, event_type, event_id, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, access_tier, query_quota_remaining
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          next.userId,
          next.eventType,
          next.eventId,
          next.stripeCustomerId,
          next.stripeSubscriptionId,
          next.stripePaymentIntentId,
          next.stripeInvoiceId,
          next.accessTier,
          next.queryQuotaRemaining,
        ],
      );
      return;
    }

    const items = this.audit.get(next.userId) ?? [];
    items.unshift(next);
    this.audit.set(next.userId, items.slice(0, 50));
  }

  async listAudit(userId: string) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        event_type: string;
        event_id: string;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        stripe_payment_intent_id: string | null;
        stripe_invoice_id: string | null;
        access_tier: BillingAccessTier;
        query_quota_remaining: number;
        created_at: Date;
      }>(
        `
          select event_type, event_id, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, stripe_invoice_id, access_tier, query_quota_remaining, created_at
          from xinus_billing_audit
          where user_id = $1
          order by created_at desc
          limit 50
        `,
        [userId],
      );

      return result.rows.map(row => ({
        eventType: row.event_type,
        eventId: row.event_id,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        stripeInvoiceId: row.stripe_invoice_id,
        accessTier: row.access_tier,
        queryQuotaRemaining: row.query_quota_remaining,
        createdAt: row.created_at.getTime(),
      }));
    }

    return this.audit.get(userId) ?? [];
  }
}

export const billingStore = new BillingStore();
export const BILLING_QUOTA_BY_TIER = FALLBACK_QUOTA_BY_TIER;
