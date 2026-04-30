# NEXINUS.net Environment Compatibility Note

This project preserves the expected deployment-facing secret names used by the current NEXINUS.net configuration surface.

## Confirmed runtime environment variables in active use

| Variable | Purpose | Used by |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Server-side Stripe API access for checkout session creation, billing portal generation, and webhook verification client setup | `server/stripeBilling.ts` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification for the exact `/api/stripe/webhook` route | `server/stripeBilling.ts` |
| `XINUS_OWNER_KEY` | Exact owner-gated sovereign control header validation for Omni and IntelliGenerate access, plus mirror seeding authority | `server/xinus.ts` |

## Compatibility statement

The backend wiring was kept aligned with the existing secret naming surface already established for the NEXINUS.net deployment. No secret values are embedded in source code. The runtime reads these values exclusively from environment configuration.

## Operational implication

If Stripe billing or owner-gated Omni access behaves unexpectedly in deployment, the first verification point should be that the three variables above are present and correctly populated in the project settings.
