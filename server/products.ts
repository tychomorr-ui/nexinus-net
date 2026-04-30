import type { BillingAccessTier } from "./billingStore";

export type ProductPlan = {
  code: BillingAccessTier;
  name: string;
  description: string;
  amountUsdCents: number;
  interval: "month";
  quota: number;
};

export const PRODUCT_PLANS: Record<BillingAccessTier, ProductPlan> = {
  mirror: {
    code: "mirror",
    name: "Mirror Registry",
    description: "Canonical access to the mirror registry and public clarity field.",
    amountUsdCents: Number(process.env.XINUS_PRICE_MIRROR_USD_CENTS ?? 1900),
    interval: "month",
    quota: 25,
  },
  sovereign: {
    code: "sovereign",
    name: "Sovereign Engine",
    description: "Expanded clarity throughput, deeper mirror activity, and sovereign runtime access.",
    amountUsdCents: Number(process.env.XINUS_PRICE_SOVEREIGN_USD_CENTS ?? 7900),
    interval: "month",
    quota: 500,
  },
  omniapi: {
    code: "omniapi",
    name: "OmniAPI",
    description: "Programmatic access to the Omni Sphere as a sovereign API surface with elevated quota.",
    amountUsdCents: Number(process.env.XINUS_PRICE_OMNIAPI_USD_CENTS ?? 29900),
    interval: "month",
    quota: 5000,
  },
};

export function getProductPlan(code: BillingAccessTier) {
  return PRODUCT_PLANS[code];
}
