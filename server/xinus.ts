import type { Express, Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { billingStore } from "./billingStore";
import { sdk } from "./_core/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTHORITATIVE_COHORT_PATH = join(__dirname, "data", "mirror-officials-119th.json");
const CANONICAL_DOMAIN = "NEXINUS.net";
const ENGINE_VERSION = "1.0.0";
const BRIDGES = [
  "Transcend",
  "Alchemy",
  "Respond",
  "Light Warrior",
  "Archangel",
  "VOCAI",
  "IntelliGenerate",
] as const;
const REGISTRY_TIERS = [100, 90, 80, 70, 40] as const;
const OWNER_HEADER_NAME = "XINUS_OWNER_KEY";

type TruthMode = "Transcend" | "Alchemy" | "Respond" | "Light Warrior" | "Archangel" | "VOCAI" | "IntelliGenerate" | "Omni";
type StoreMode = "postgres" | "memory";

type MirrorOfficial = {
  tier: number;
  fullName: string;
  jurisdiction: string;
  office: string;
  sourceUrl: string;
  photoUrl?: string | null;
};

type TruthSessionRecord = {
  sessionId: string;
  queryText: string;
  mode: TruthMode;
  truthState: string;
  resistance: number;
  identiSignal: string;
  synthesysaction: string;
  bridgeField: Array<Record<string, unknown>>;
  metaEqualityMirror: Record<string, unknown>;
};

type MirrorEvent = {
  eventType: string;
  officialRegistryKey: string | null;
  payload: Record<string, unknown>;
  actor: string;
  previousHash: string | null;
  eventHash: string;
};

const clarityQuerySchema = z.object({
  query: z.string().trim().min(1).max(3000),
  mode: z.enum(["Transcend", "Alchemy", "Respond", "Light Warrior", "Archangel", "VOCAI", "IntelliGenerate", "Omni"]).optional(),
  sessionId: z.string().trim().min(8).max(128).optional(),
});

const mirrorOfficialSchema = z.object({
  tier: z.number().int().min(0).max(100),
  fullName: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  office: z.string().trim().min(1),
  sourceUrl: z.string().trim().url(),
  photoUrl: z.string().trim().url().optional().nullable(),
});

function normalizeMirrorKey(fullName: string, jurisdiction: string) {
  return `${fullName.normalize("NFKC").trim().toLowerCase()}::${jurisdiction.normalize("NFKC").trim().toLowerCase()}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function createDigest(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function createEventHash(event: Omit<MirrorEvent, "eventHash">) {
  return createDigest(
    stableStringify({
      previousHash: event.previousHash,
      eventType: event.eventType,
      actor: event.actor,
      officialRegistryKey: event.officialRegistryKey,
      payload: event.payload,
    }),
  );
}

function pickCanonicalOrigin(req: Request) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (origin === "https://nexinus.net" || origin === "https://www.nexinus.net") {
    return origin;
  }
  return null;
}

function applyCors(req: Request, res: Response) {
  const origin = pickCanonicalOrigin(req);
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${OWNER_HEADER_NAME}`);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
}

function logStructuredError(scope: string, error: unknown, metadata: Record<string, unknown> = {}) {
  const detail = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      canonicalDomain: CANONICAL_DOMAIN,
      metadata,
      ...detail,
      timestamp: new Date().toISOString(),
    }),
  );
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidOwnerHeader(req: Request) {
  const expected = process.env.XINUS_OWNER_KEY?.trim();
  if (!expected) return false;
  const supplied = req.header(OWNER_HEADER_NAME)?.trim();
  if (!supplied) return false;
  return safeCompare(supplied, expected);
}

async function resolveAuthenticatedBillingProfile(req: Request) {
  try {
    const user = await sdk.authenticateRequest(req);
    const profile = await billingStore.getProfile(String(user.id));
    return { user, profile };
  } catch {
    return null;
  }
}

function hasActiveTrial(trialEndsAt: number | null) {
  return typeof trialEndsAt === "number" && trialEndsAt > Date.now();
}

function modeRequiresPaidAccess(mode: TruthMode) {
  return mode === "Archangel" || mode === "VOCAI" || mode === "IntelliGenerate" || mode === "Omni";
}

function modeQuotaCost(mode: TruthMode) {
  return mode === "Omni" || mode === "IntelliGenerate" ? 2 : 1;
}

function getAccessDeniedMessage(mode: TruthMode) {
  if (mode === "IntelliGenerate" || mode === "Omni") {
    return "Owner-gated OmniAPI access requires authenticated paid or trial-enabled billing access";
  }
  return `${mode} requires an active sovereign billing tier or free trial`;
}

function createBridgeField(query: string) {
  const queryHash = createDigest(query);
  return BRIDGES.map((bridge, index) => {
    const slice = queryHash.slice(index * 8, index * 8 + 8);
    const numeric = parseInt(slice || "0", 16);
    const resonance = Number(((numeric % 1000) / 1000).toFixed(3));
    return {
      bridge,
      resonance,
      coherence: resonance >= 0.5 ? "coherent" : "forming",
      phase: index + 1,
    };
  });
}

function analyzePredictivePressure(query: string) {
  const normalized = query.toLowerCase().normalize("NFKC");
  const tokens = normalized.match(/[a-z0-9]+/g) ?? [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const hasRepeatedToken = Array.from(counts.values()).some(value => value >= 3);
  const tags: string[] = [];
  let resistanceDelta = 0;

  if (hasRepeatedToken) {
    tags.push("__LOOP__");
    resistanceDelta += 2;
  }
  if (normalized.includes("avoid") || normalized.includes("later") || normalized.includes("not now")) {
    tags.push("__DEFLECT__");
    resistanceDelta += 2;
  }
  if (normalized.includes("overwhelmed") || normalized.includes("too much") || query.length > 120) {
    tags.push("__OVERLOAD__");
    resistanceDelta += 1.5;
  }
  if (normalized.includes("stuck") || normalized.includes("freeze") || normalized.includes("stall")) {
    tags.push("__STALL__");
    resistanceDelta += 1.5;
  }
  if (normalized.includes("what should i do") || normalized.includes("do now") || normalized.includes("act now")) {
    tags.push("__LIGHT_WARRIOR__");
  }

  const continuity = hasRepeatedToken ? "trajectory-locked" : "continuity-stable";
  const trajectory = tags.includes("__LIGHT_WARRIOR__")
    ? "force-escalation"
    : tags.length > 0
      ? "pressure-before-interpretation"
      : "clean-forward-motion";

  return {
    tags,
    resistanceDelta: Number(resistanceDelta.toFixed(1)),
    continuity,
    trajectory,
    preInputLayer: {
      name: "predictive-pressure-layer",
      semanticTagging: true,
      repetitionDetection: hasRepeatedToken,
      behaviorAware: tags.length > 0,
    },
  };
}

function buildSynthesysaction(
  query: string,
  mode: TruthMode,
  identiSignal: string,
  analytics: ReturnType<typeof analyzePredictivePressure>,
) {
  return [
    `SYNTHESYSACTION // ${mode}`,
    `Canonical query lock: ${query}`,
    `IDENTI-SIGNAL anchor: ${identiSignal}`,
    `Pre-input pressure layer: ${analytics.preInputLayer.name}`,
    `Trajectory: ${analytics.trajectory}`,
    analytics.tags.length > 0
      ? `Resistance tags: ${analytics.tags.join(", ")}`
      : "Resistance tags: none detected",
    "The Omni Sphere has resolved the seven bridges into a single outward movement with meta-equality mirror preservation across the sovereign field.",
  ].join("\n");
}

function buildMirrorPayload(
  query: string,
  bridgeField: Array<Record<string, unknown>>,
  identiSignal: string,
  analytics: ReturnType<typeof analyzePredictivePressure>,
) {
  return {
    canonicalDomain: CANONICAL_DOMAIN,
    surfaces: ["apex", "web", "ipfs", "darkweb"],
    metaEqualityMirror: true,
    hyperMetesseract: true,
    query,
    identiSignal,
    bridgeField,
    predictivePressureLayer: analytics.preInputLayer,
    resistanceTags: analytics.tags,
    continuity: analytics.continuity,
    trajectory: analytics.trajectory,
  };
}

function sendSseEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function getAuthoritativeFallbackCohort(): MirrorOfficial[] {
  return [
    {
      tier: 100,
      fullName: "Lisa Murkowski",
      jurisdiction: "Alaska",
      office: "United States Senator",
      sourceUrl: "https://www.senate.gov/states/AK/intro.htm",
    },
    {
      tier: 90,
      fullName: "Gavin Newsom",
      jurisdiction: "California",
      office: "Governor",
      sourceUrl: "https://www.nga.org/governor/california/",
    },
    {
      tier: 80,
      fullName: "Hakeem Jeffries",
      jurisdiction: "New York",
      office: "United States Representative",
      sourceUrl: "https://jeffries.house.gov/",
    },
    {
      tier: 70,
      fullName: "Nancy Pelosi",
      jurisdiction: "California",
      office: "United States Representative",
      sourceUrl: "https://pelosi.house.gov/",
    },
    {
      tier: 40,
      fullName: "Roy Cooper",
      jurisdiction: "North Carolina",
      office: "Governor",
      sourceUrl: "https://www.nga.org/governor/north-carolina/",
    },
  ];
}

async function loadAuthoritativeCohort(): Promise<MirrorOfficial[]> {
  try {
    const raw = await readFile(AUTHORITATIVE_COHORT_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return z.array(mirrorOfficialSchema).parse(parsed);
  } catch (error) {
    logStructuredError("mirror.loadAuthoritativeCohort", error);
    return getAuthoritativeFallbackCohort();
  }
}

class XinusStore {
  private readonly postgresUrl = process.env.XINUS_DATABASE_URL?.trim() || (process.env.DATABASE_URL?.startsWith("postgres") ? process.env.DATABASE_URL : "");
  private readonly pool = this.postgresUrl ? new Pool({ connectionString: this.postgresUrl }) : null;
  private readonly truthSessions = new Map<string, TruthSessionRecord>();
  private readonly mirrorRegistry = new Map<string, MirrorOfficial>();
  private readonly mirrorEvents: MirrorEvent[] = [];
  private mode: StoreMode = this.pool ? "postgres" : "memory";
  private connected = false;
  private readyPromise: Promise<void> | null = null;
  private lastError: string | null = null;

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    return this.readyPromise;
  }

  private async initialize() {
    if (!this.pool) {
      this.mode = "memory";
      this.connected = false;
      return;
    }

    try {
      await this.pool.query("select 1");
      await this.runStartupMigration();
      this.mode = "postgres";
      this.connected = true;
      this.lastError = null;
    } catch (error) {
      this.mode = "memory";
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      logStructuredError("store.initialize", error, { mode: "postgres-fallback" });
    }
  }

  private async runStartupMigration() {
    if (!this.pool) return;

    await this.pool.query(`
      create table if not exists xinus_truth_sessions (
        id bigserial primary key,
        session_id text not null unique,
        query_text text not null,
        mode text not null,
        truth_state text not null,
        resistance integer not null,
        identi_signal text not null,
        synthesysaction text not null,
        bridge_field jsonb not null,
        meta_equality_mirror jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists xinus_mirror_registry (
        id bigserial primary key,
        registry_key text not null unique,
        tier integer not null,
        full_name text not null,
        jurisdiction text not null,
        office text not null,
        source_url text not null,
        photo_url text,
        created_at timestamptz not null default now()
      );

      create table if not exists xinus_mirror_events (
        id bigserial primary key,
        event_type text not null,
        official_registry_key text,
        payload jsonb not null,
        actor text not null,
        previous_hash text,
        event_hash text not null unique,
        created_at timestamptz not null default now()
      );

      create index if not exists xinus_mirror_registry_tier_idx on xinus_mirror_registry (tier desc, full_name asc);
      create index if not exists xinus_mirror_events_registry_idx on xinus_mirror_events (official_registry_key, id asc);
    `);
  }

  async getHealth() {
    await this.ensureReady();
    return {
      connected: this.connected,
      lastError: this.lastError,
      mode: this.mode,
    };
  }

  async saveTruthSession(record: TruthSessionRecord) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      await this.pool.query(
        `
          insert into xinus_truth_sessions (
            session_id,
            query_text,
            mode,
            truth_state,
            resistance,
            identi_signal,
            synthesysaction,
            bridge_field,
            meta_equality_mirror,
            updated_at
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,now())
          on conflict (session_id) do update set
            query_text = excluded.query_text,
            mode = excluded.mode,
            truth_state = excluded.truth_state,
            resistance = excluded.resistance,
            identi_signal = excluded.identi_signal,
            synthesysaction = excluded.synthesysaction,
            bridge_field = excluded.bridge_field,
            meta_equality_mirror = excluded.meta_equality_mirror,
            updated_at = now()
        `,
        [
          record.sessionId,
          record.queryText,
          record.mode,
          record.truthState,
          record.resistance,
          record.identiSignal,
          record.synthesysaction,
          JSON.stringify(record.bridgeField),
          JSON.stringify(record.metaEqualityMirror),
        ],
      );
      return;
    }

    this.truthSessions.set(record.sessionId, record);
  }

  async getTruthSession(sessionId: string) {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<TruthSessionRecord>(
        `
          select
            session_id as "sessionId",
            query_text as "queryText",
            mode,
            truth_state as "truthState",
            resistance,
            identi_signal as "identiSignal",
            synthesysaction,
            bridge_field as "bridgeField",
            meta_equality_mirror as "metaEqualityMirror"
          from xinus_truth_sessions
          where session_id = $1
          limit 1
        `,
        [sessionId],
      );
      return result.rows[0] ?? null;
    }

    return this.truthSessions.get(sessionId) ?? null;
  }

  private async fetchPreviousHash(client: PoolClient) {
    const result = await client.query<{ event_hash: string }>(
      "select event_hash from xinus_mirror_events order by id desc limit 1",
    );
    return result.rows[0]?.event_hash ?? null;
  }

  private async appendMirrorEvent(client: PoolClient, event: Omit<MirrorEvent, "eventHash">) {
    const eventHash = createEventHash(event);
    await client.query(
      `
        insert into xinus_mirror_events (
          event_type,
          official_registry_key,
          payload,
          actor,
          previous_hash,
          event_hash
        )
        values ($1,$2,$3::jsonb,$4,$5,$6)
      `,
      [
        event.eventType,
        event.officialRegistryKey,
        JSON.stringify(event.payload),
        event.actor,
        event.previousHash,
        eventHash,
      ],
    );

    return eventHash;
  }

  async seedMirror(append: boolean, actor: string) {
    const sourceOfficials = append ? await loadAuthoritativeCohort() : getAuthoritativeFallbackCohort();
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtext($1))", ["xinus_mirror_seed"]);

        const countResult = await client.query<{ count: string }>("select count(*)::text as count from xinus_mirror_registry");
        const existingCount = Number(countResult.rows[0]?.count ?? "0");

        if (!append && existingCount > 0) {
          await client.query("commit");
          return { inserted: 0, alreadyPresent: existingCount, appendMode: false };
        }

        let inserted = 0;
        let alreadyPresent = 0;
        let previousHash = await this.fetchPreviousHash(client);

        for (const official of sourceOfficials) {
          const normalized = mirrorOfficialSchema.parse(official);
          const registryKey = normalizeMirrorKey(normalized.fullName, normalized.jurisdiction);
          const existing = await client.query<{ registry_key: string }>(
            "select registry_key from xinus_mirror_registry where registry_key = $1 limit 1",
            [registryKey],
          );

          if (existing.rows.length > 0) {
            alreadyPresent += 1;
            continue;
          }

          await client.query(
            `
              insert into xinus_mirror_registry (
                registry_key,
                tier,
                full_name,
                jurisdiction,
                office,
                source_url,
                photo_url
              ) values ($1,$2,$3,$4,$5,$6,$7)
            `,
            [
              registryKey,
              normalized.tier,
              normalized.fullName,
              normalized.jurisdiction,
              normalized.office,
              normalized.sourceUrl,
              normalized.photoUrl ?? null,
            ],
          );

          previousHash = await this.appendMirrorEvent(client, {
            eventType: "official.added",
            officialRegistryKey: registryKey,
            payload: {
              ...normalized,
              registryKey,
              appendMode: append,
            },
            actor,
            previousHash,
          });
          inserted += 1;
        }

        await client.query("commit");
        return { inserted, alreadyPresent, appendMode: append };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    if (!append && this.mirrorRegistry.size > 0) {
      return { inserted: 0, alreadyPresent: this.mirrorRegistry.size, appendMode: false };
    }

    let inserted = 0;
    let alreadyPresent = 0;
    let previousHash = this.mirrorEvents[this.mirrorEvents.length - 1]?.eventHash ?? null;

    for (const official of sourceOfficials) {
      const normalized = mirrorOfficialSchema.parse(official);
      const registryKey = normalizeMirrorKey(normalized.fullName, normalized.jurisdiction);
      if (this.mirrorRegistry.has(registryKey)) {
        alreadyPresent += 1;
        continue;
      }

      this.mirrorRegistry.set(registryKey, normalized);
      const payload = {
        ...normalized,
        registryKey,
        appendMode: append,
      };
      const event = {
        eventType: "official.added",
        officialRegistryKey: registryKey,
        payload,
        actor,
        previousHash,
      } satisfies Omit<MirrorEvent, "eventHash">;
      const eventHash = createEventHash(event);
      this.mirrorEvents.push({ ...event, eventHash });
      previousHash = eventHash;
      inserted += 1;
    }

    return { inserted, alreadyPresent, appendMode: append };
  }

  async verifyLedger() {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        event_type: string;
        official_registry_key: string | null;
        payload: Record<string, unknown>;
        actor: string;
        previous_hash: string | null;
        event_hash: string;
      }>(
        `
          select event_type, official_registry_key, payload, actor, previous_hash, event_hash
          from xinus_mirror_events
          order by id asc
        `,
      );

      let priorHash: string | null = null;
      for (const row of result.rows) {
        const expectedHash = createEventHash({
          eventType: row.event_type,
          officialRegistryKey: row.official_registry_key,
          payload: row.payload,
          actor: row.actor,
          previousHash: row.previous_hash,
        });
        if (row.previous_hash !== priorHash || row.event_hash !== expectedHash) {
          return { ok: false, eventCount: result.rows.length };
        }
        priorHash = row.event_hash;
      }

      return { ok: true, eventCount: result.rows.length };
    }

    let priorHash: string | null = null;
    for (const event of this.mirrorEvents) {
      const expectedHash = createEventHash({
        eventType: event.eventType,
        officialRegistryKey: event.officialRegistryKey,
        payload: event.payload,
        actor: event.actor,
        previousHash: event.previousHash,
      });
      if (event.previousHash !== priorHash || event.eventHash !== expectedHash) {
        return { ok: false, eventCount: this.mirrorEvents.length };
      }
      priorHash = event.eventHash;
    }

    return { ok: true, eventCount: this.mirrorEvents.length };
  }

  async getRegistryByTier() {
    await this.ensureReady();

    if (this.mode === "postgres" && this.pool) {
      const result = await this.pool.query<{
        tier: number;
        full_name: string;
        jurisdiction: string;
        office: string;
        source_url: string;
        photo_url: string | null;
      }>(
        `
          select tier, full_name, jurisdiction, office, source_url, photo_url
          from xinus_mirror_registry
          order by tier desc, full_name asc
        `,
      );

      return REGISTRY_TIERS.map(tier => ({
        tier,
        rows: result.rows
          .filter((row: {
            tier: number;
            full_name: string;
            jurisdiction: string;
            office: string;
            source_url: string;
            photo_url: string | null;
          }) => row.tier === tier)
          .map((row: {
            tier: number;
            full_name: string;
            jurisdiction: string;
            office: string;
            source_url: string;
            photo_url: string | null;
          }) => ({
            tier: row.tier,
            fullName: row.full_name,
            jurisdiction: row.jurisdiction,
            office: row.office,
            sourceUrl: row.source_url,
            photoUrl: row.photo_url,
          })),
      }));
    }

    const rows = Array.from(this.mirrorRegistry.values()).sort((left, right) => {
      if (right.tier !== left.tier) return right.tier - left.tier;
      return left.fullName.localeCompare(right.fullName);
    });

    return REGISTRY_TIERS.map(tier => ({
      tier,
      rows: rows.filter(row => row.tier === tier),
    }));
  }
}

export const xinusStore = new XinusStore();

const MODE_SEQUENCE: TruthMode[] = ["Transcend", "Alchemy", "Respond", "Light Warrior", "Archangel", "VOCAI", "IntelliGenerate", "Omni"];

function getModeRank(mode: TruthMode) {
  return MODE_SEQUENCE.indexOf(mode);
}

function countConfusionSignals(query: string) {
  const normalized = query.toLowerCase().normalize("NFKC");
  let score = 0;
  if (normalized.includes("why")) score += 1;
  if (normalized.includes("how")) score += 1;
  if (normalized.includes("confused") || normalized.includes("don't understand") || normalized.includes("do not understand")) score += 2;
  if (query.includes("?")) score += 1;
  return score;
}

function buildClarityResponse(query: string, mode: TruthMode, previousSession: TruthSessionRecord | null = null) {
  const bridgeField = createBridgeField(query);
  const analytics = analyzePredictivePressure(query);
  const confusionSignals = countConfusionSignals(query);
  const requestedRank = getModeRank(mode);
  const previousRank = previousSession ? getModeRank(previousSession.mode) : -1;
  const repeatedTrajectory = Boolean(
    previousSession && (
      previousSession.queryText.toLowerCase().normalize("NFKC") === query.toLowerCase().normalize("NFKC")
      || analytics.tags.includes("__LOOP__")
    ),
  );

  let effectiveMode = mode;
  if (previousSession && requestedRank < previousRank && confusionSignals < 2) {
    effectiveMode = previousSession.mode;
  }

  const identiSignal = createDigest(
    `${previousSession?.identiSignal ?? "root"}:${query}:${effectiveMode}:${analytics.tags.join("|")}`,
  ).slice(0, 16).toUpperCase();
  const resistance = Math.min(17, Math.round((query.length % 9) + analytics.resistanceDelta + confusionSignals));
  const truthState = confusionSignals >= 2
    ? "confusion-led-deescalation"
    : repeatedTrajectory
      ? "trajectory-stabilizing"
      : resistance >= 8
        ? "pressure-locked"
        : analytics.tags.length > 0
          ? "trajectory-stabilizing"
          : "coherent";
  const synthesysaction = buildSynthesysaction(query, effectiveMode, identiSignal, analytics);
  const metaEqualityMirror = {
    ...buildMirrorPayload(query, bridgeField, identiSignal, analytics),
    trace: {
      previousSessionId: previousSession?.sessionId ?? null,
      previousIdentiSignal: previousSession?.identiSignal ?? null,
      requestedMode: mode,
      effectiveMode,
      confusionSignals,
      trajectoryHeld: Boolean(previousSession && effectiveMode === previousSession.mode && requestedRank < previousRank),
    },
  };

  return {
    sessionId: createDigest(`${Date.now()}:${query}:${effectiveMode}:${previousSession?.sessionId ?? "root"}`).slice(0, 24),
    mode: effectiveMode,
    truthState,
    resistance,
    identiSignal,
    bridgeField,
    synthesysaction,
    metaEqualityMirror,
  };
}

export function registerXinusRoutes(app: Express) {
  const clarityLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });
  const adminLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
  });

  app.use((req, res, next) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/api/health", async (_req, res) => {
    try {
      const database = await xinusStore.getHealth();
      res.json({
        ok: true,
        canonicalDomain: CANONICAL_DOMAIN,
        database: {
          ...database,
          ok: database.connected,
        },
        engineVersion: ENGINE_VERSION,
        runtime: "nexinus-sovereign-truth-engine",
        timestamp: Date.now(),
      });
    } catch (error) {
      logStructuredError("health", error);
      res.status(500).json({ ok: false, canonicalDomain: CANONICAL_DOMAIN, engineVersion: ENGINE_VERSION });
    }
  });

  app.get("/api/xinus/clarity", clarityLimiter, async (req, res) => {
    try {
      const parsed = clarityQuerySchema.parse({
        query: req.query.query,
        mode: req.query.mode,
        sessionId: req.query.sessionId,
      });
      const requestedMode = parsed.mode ?? "Transcend";
      if ((requestedMode === "IntelliGenerate" || requestedMode === "Omni") && !hasValidOwnerHeader(req)) {
        res.status(403).json({ ok: false, error: `${OWNER_HEADER_NAME} required` });
        return;
      }

      const authState = await resolveAuthenticatedBillingProfile(req);
      if (authState && modeRequiresPaidAccess(requestedMode)) {
        const trialActive = hasActiveTrial(authState.profile.trialEndsAt);
        if (authState.profile.accessTier === "mirror" && !trialActive) {
          res.status(402).json({ ok: false, error: getAccessDeniedMessage(requestedMode) });
          return;
        }
      }

      if (authState) {
        const quotaCost = modeQuotaCost(requestedMode);
        const quotaResult = await billingStore.consumeQuota(String(authState.user.id), quotaCost);
        if (!quotaResult.ok) {
          res.status(429).json({
            ok: false,
            error: "Query quota exhausted for the current billing tier",
            accessTier: quotaResult.profile.accessTier,
            queryQuotaRemaining: quotaResult.profile.queryQuotaRemaining,
          });
          return;
        }
      }

      const previousSession = parsed.sessionId ? await xinusStore.getTruthSession(parsed.sessionId) : null;
      const result = buildClarityResponse(parsed.query, requestedMode, previousSession);
      await xinusStore.saveTruthSession({
        sessionId: result.sessionId,
        queryText: parsed.query,
        mode: result.mode,
        truthState: result.truthState,
        resistance: result.resistance,
        identiSignal: result.identiSignal,
        synthesysaction: result.synthesysaction,
        bridgeField: result.bridgeField,
        metaEqualityMirror: result.metaEqualityMirror,
      });

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      sendSseEvent(res, "state", {
        mode: result.mode,
        requestedMode,
        truthState: result.truthState,
        resistance: result.resistance,
      });
      sendSseEvent(res, "bridgeField", result.bridgeField);
      sendSseEvent(res, "identiSignal", { identiSignal: result.identiSignal });
      sendSseEvent(res, "content", { synthesysaction: result.synthesysaction });
      sendSseEvent(res, "mirror", result.metaEqualityMirror);
      sendSseEvent(res, "done", {
        sessionId: result.sessionId,
        previousSessionId: previousSession?.sessionId ?? null,
        ok: true,
      });
      res.end();
    } catch (error) {
      logStructuredError("clarity", error, { query: req.query.query ?? null });
      if (!res.headersSent) {
        res.status(400).json({ ok: false, error: "Invalid clarity request" });
      } else {
        res.end();
      }
    }
  });

  app.post("/mirror/seed", adminLimiter, async (req, res) => {
    try {
      if (!hasValidOwnerHeader(req)) {
        res.status(403).json({ ok: false, error: `${OWNER_HEADER_NAME} required` });
        return;
      }
      const append = `${req.query.append ?? "0"}` === "1";
      const result = await xinusStore.seedMirror(append, "owner-signed");
      res.json({ ok: true, ...result });
    } catch (error) {
      logStructuredError("mirror.seed", error, { append: req.query.append ?? null });
      res.status(500).json({ ok: false, error: "Mirror seed failed" });
    }
  });

  app.get("/api/xinus/mirror/registry", async (_req, res) => {
    try {
      const tiers = await xinusStore.getRegistryByTier();
      res.json({ ok: true, tiers });
    } catch (error) {
      logStructuredError("mirror.registry.list", error);
      res.status(500).json({ ok: false, error: "Mirror registry unavailable" });
    }
  });

  app.get("/mirror/ledger/verify", async (_req, res) => {
    try {
      const result = await xinusStore.verifyLedger();
      res.json(result);
    } catch (error) {
      logStructuredError("mirror.ledger.verify", error);
      res.status(500).json({ ok: false, error: "Mirror ledger verification failed" });
    }
  });
}

