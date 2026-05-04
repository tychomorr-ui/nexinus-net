# XINUS

A **Reflective Intelligence** engine for people who don't have time to overthink.

Live at **[nexinus.net](https://www.nexinus.net)**.

Built end-to-end on an iPhone 16 Pro Max. No laptop, no desktop, no IDE on a real keyboard — every line, every deploy, every Stripe webhook from a phone. By a carpenter, not a CS grad.

## Reflective Intelligence (RI)

RI is not AI. AI generates. RI reflects.

A generative model takes a prompt and produces plausible text. A reflective engine takes a person's situation and returns the next move — sometimes via a model, sometimes via a deterministic pipeline, sometimes via a structural pattern match. The output is the same shape regardless of source: `state` → `content` → `done`. The user never has to know which path ran. They just get clarity.

This matters because most "AI products" collapse the moment the model is slow, rate-limited, or wrong. XINUS keeps responding. Three of its five public modes never call a model at all.

### The canonical apex pipeline

Every RI surface in this suite implements the same canonical loop:

```
DETECT → REFLECT → CLARIFY → DIRECT → EXECUTE → REPEAT
```

Concretely:

- **DETECT** — apply per-event deltas to the user's state machine (risk score, clarity, streak, mode). Deterministic. No interpretation.
- **REFLECT** — derive metrics from the recent event window (trigger frequency, momentum, inactivity, non-execution count). Pure functions, no I/O.
- **CLARIFY** — collapse the entire state-and-metric surface into exactly **one reflection + one next action**. Priority-ordered ladder, always returns; an emergency state locks the output to the canonical grounding pair, no exceptions.
- **DIRECT** — emit the directive. Voice/UI consume it; they do not generate independently.
- **EXECUTE** — wait for the user's response. A `task_complete` event resets non-execution bookkeeping. A missed directive starts an escalation timer that walks the user down a deterministic ladder of physical, micro, unavoidable actions.
- **REPEAT** — the loop is the only thing that mutates state. There is no second writer. There is no other code path.

This is the **canonical apex pipeline** — same shape in every surface, instantiated three times in the codebase:

- `artifacts/xinus-recidivism/src/lib/pipeline.ts` — the reference implementation. 358 lines of pure deterministic logic. Zero model calls.
- `artifacts/xinus-pd-pro/src/lib/engine.ts` — the dual-mode (client / public defender) variant. Same `processEvent` discipline: one mutator, no side effects.
- `artifacts/api-server/src/routes/xinus/index.ts` (Transcend mode) — the cross-domain instance: `sanitize → decompose → extractPattern → resolve → integrametric → mapIdentity → synthesizeAction → project`.

When the model layer is up, Core/Expand/Ascend/Warrior modes wrap their model output in the same SSE protocol the deterministic pipelines emit, so the client renderer can't tell the difference. When the model layer is down, the deterministic pipelines still run. The product never goes dark.

That's what makes the RI claim defensible: there is a canonical pipeline you can run with the model unplugged.

## What this is

XINUS is a small suite of streaming RI tools sharing one engine and one paywall. The engine is interesting because it isn't always a model call — three of the five public modes are deterministic, and the most powerful one is hidden behind constant-time auth so its existence isn't leakable.

Four products in the suite, all served from the same domain via path-based routing:

| Path | Product | What it does |
|---|---|---|
| `/` | **XINUS Clarity** | Five-mode streaming engine. The flagship. |
| `/office-pro/` | **XINUS Office Pro** | Senior executive assistant in chat form. |
| `/recidivism/` | **XINUS Recidivism** | Subject dashboards + Clarity handoff for behavioral anchors. |
| `/pd-pro/` | **XINUS PD PRO** | Dual-mode field engine for officers. |

## Architecture worth pointing at

This is a pnpm monorepo. Each product is a separate Vite app in `artifacts/`, plus one Express API server. The platform routes `/api/*` to the API server and each `/<slug>/*` to its app. All five processes share one Postgres and one OpenAI key.

A few decisions I'd defend:

**SSE protocol over WebSockets.** Every streaming endpoint speaks the same three-event SSE wire format: `state` → `content`* → `done`. Clients don't care whether the response came from a model call or a deterministic pipeline — the protocol is identical. This is what lets Transcend mode (no model call, returns instantly) and Core mode (model streaming) share a single React renderer with zero branching. The wire format is the contract; the engine behind it is interchangeable.

**Deterministic mode behind the same protocol.** `transcend` is a hand-written pipeline: `sanitize → decompose → extractPattern → resolve → integrametric → mapIdentity → synthesizeAction → project`. It returns in milliseconds with no model cost. This is the part most products can't do — they fall over the moment the model is slow or down. XINUS keeps responding because the engine isn't the model.

**Constant-time auth on the privileged mode.** The `omni` mode (owner-only) is gated by `isOwner()` in `artifacts/api-server/src/lib/security.ts`. Wrong key, missing key, or any non-owner request gets an indistinguishable `404 Not Found` — same status, same body, same headers as a real 404 from the router. The mode's existence doesn't leak from the API surface. Frontend unlock is intentionally clunky (7 quick taps on the sigil) so it can't be discovered casually.

**One quota system, two products, zero duplication.** Free users get 5 Expand runs/week and 3 Office Pro generations/week. Both are gated by the same `consumeFreeQuota(userId, mode)` function backed by an atomic upsert with a guard clause — race-safe under concurrent requests. The 402 response carries the full quota snapshot in the JSON body and as `X-Free-Quota-*` HTTP headers, so SSE clients (which can't read a JSON body before the stream starts) can update UI from headers alone.

**Stripe webhook is the only writer of subscription state.** The checkout endpoint refuses to start if `STRIPE_WEBHOOK_SECRET` isn't set — fail-safe. No optimistic flips on checkout completion in the UI; the source of truth is the webhook. Frontend polls `/billing/me` after the redirect to pick up the change.

**Cross-app checkout return path with allowlist.** Office Pro's checkout redirects back to `/office-pro/?billing=success` instead of the account page, so the user lands where they were. The `returnPath` is sanitized server-side against a fixed allowlist — clients can't aim Stripe at an arbitrary domain.

## Stack

- **Frontend:** React + Vite + Tailwind + wouter (intentionally not React Router — wouter is ~1.5KB)
- **Backend:** Node + Express + TypeScript
- **DB:** Postgres + Drizzle ORM
- **Streaming:** SSE (no WebSockets — see above)
- **Model layer:** OpenAI streaming via the Replit AI Integrations proxy (one of several engine sources behind the RI protocol)
- **Payments:** Stripe Checkout + Customer Portal + signed webhooks
- **Hosting:** Replit Deployments with custom domain + auto-issued TLS

## Code worth reading

- `artifacts/api-server/src/routes/xinus/index.ts` — mode router, SSE protocol, Light Warrior + Transcend deterministic paths
- `artifacts/api-server/src/lib/security.ts` — constant-time owner check, mode sanitization
- `artifacts/api-server/src/lib/quota.ts` — atomic free-quota counter, ISO-week boundaries
- `artifacts/api-server/src/routes/billing.ts` — Stripe Checkout, signed webhook, customer portal, returnPath allowlist
- `artifacts/xinus/src/pages/Home.tsx` — the chat UI; mode selector, Light Warrior handoff, owner-key unlock
- `artifacts/xinus-office-pro/src/pages/Office.tsx` — quota badge, optimistic message rollback on 402, post-checkout polling

## Built by

A carpenter. Solo, end to end, on an iPhone 16 Pro Max. Live at [nexinus.net](https://www.nexinus.net).
