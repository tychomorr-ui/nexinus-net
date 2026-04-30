import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Crown,
  Loader2,
  Lock,
  Orbit,
  Shield,
  Sparkles,
  Waves,
} from "lucide-react";

type BridgePoint = {
  bridge: string;
  resonance: number;
  coherence: string;
  phase: number;
};

const BRIDGES = [
  "Transcend",
  "Alchemy",
  "Respond",
  "Light Warrior",
  "Archangel",
  "VOCAI",
  "IntelliGenerate",
] as const;

const PUBLIC_MODES = BRIDGES;
const OWNER_ONLY_MODES = ["IntelliGenerate", "Omni"] as const;

const PRESSURE_PILLARS = [
  {
    title: "Predictive Pre-Input Pressure Layer",
    description:
      "NEXINUS reads trajectory before final interpretation so the OmniAPI reconstructs continuity instead of reacting to isolated fragments.",
  },
  {
    title: "IDENTI-SIGNAL Continuity",
    description:
      "Identity continuity stays visible across turns, preserving trace stability, resistance pressure, and canonical bridge-state alignment.",
  },
  {
    title: "Resistance Escalation Logic",
    description:
      "State progression is stable under repetition and only yields when genuine confusion signals overcome the canonical pressure threshold.",
  },
] as const;

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<(typeof PUBLIC_MODES)[number]>("Transcend");
  const [isStreaming, setIsStreaming] = useState(false);
  const [truthState, setTruthState] = useState("waiting");
  const [resistance, setResistance] = useState(0);
  const [identiSignal, setIdentiSignal] = useState("STANDBY");
  const [synthesysaction, setSynthesysaction] = useState(
    "The Omni Sphere is waiting for a canonical clarity query.",
  );
  const [bridgeField, setBridgeField] = useState<BridgePoint[]>(() =>
    BRIDGES.map((bridge, index) => ({
      bridge,
      resonance: 0,
      coherence: "forming",
      phase: index + 1,
    })),
  );

  const plansQuery = trpc.billing.plans.useQuery();
  const billingStatusQuery = trpc.billing.status.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const checkoutMutation = trpc.billing.createCheckout.useMutation();
  const billingPortalMutation = trpc.billing.createBillingPortal.useMutation();

  useEffect(() => {
    return () => {
      setIsStreaming(false);
    };
  }, []);

  const dominantBridge = useMemo(() => {
    return [...bridgeField].sort((a, b) => b.resonance - a.resonance)[0]?.bridge ?? "Transcend";
  }, [bridgeField]);

  const resistancePercent = Math.min(100, Math.round((resistance / 16) * 100));
  const quotaProfile = billingStatusQuery.data;

  const handleRunClarity = () => {
    const trimmed = query.trim();
    if (!trimmed) {
      toast.error("Enter a clarity query before activating the Omni Sphere.");
      return;
    }

    const params = new URLSearchParams({
      query: trimmed,
      mode,
    });

    const stream = new EventSource(`/api/xinus/clarity?${params.toString()}`);
    setIsStreaming(true);
    setTruthState("streaming");
    setSynthesysaction("The Omni Sphere is converging the bridge field...");

    stream.addEventListener("state", event => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        truthState: string;
        resistance: number;
      };
      setTruthState(payload.truthState);
      setResistance(payload.resistance);
    });

    stream.addEventListener("bridgeField", event => {
      const payload = JSON.parse((event as MessageEvent).data) as BridgePoint[];
      setBridgeField(payload);
    });

    stream.addEventListener("identiSignal", event => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        identiSignal: string;
      };
      setIdentiSignal(payload.identiSignal);
    });

    stream.addEventListener("content", event => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        synthesysaction: string;
      };
      setSynthesysaction(payload.synthesysaction);
    });

    stream.addEventListener("done", () => {
      setIsStreaming(false);
      stream.close();
    });

    stream.onerror = () => {
      setIsStreaming(false);
      setTruthState("degraded");
      toast.error("The clarity stream could not be completed.");
      stream.close();
    };
  };

  const handleCheckout = async (tier: "mirror" | "sovereign" | "omniapi") => {
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }

    try {
      const result = await checkoutMutation.mutateAsync({ tier });
      toast.success(
        result.freeTrialDays > 0
          ? `Launching checkout with a ${result.freeTrialDays}-day free trial.`
          : "Launching checkout in a new tab.",
      );
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to launch checkout.");
    }
  };

  const handlePortal = async () => {
    try {
      const result = await billingPortalMutation.mutateAsync();
      toast.success("Opening the billing portal in a new tab.");
      window.open(result.portalUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Billing portal unavailable.");
    }
  };

  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <main className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(94,61,255,0.24),transparent_32%),radial-gradient(circle_at_78%_18%,rgba(0,214,201,0.18),transparent_24%),linear-gradient(180deg,#050816_0%,#090d1e_44%,#04050c_100%)]" />
        <div className="absolute left-1/2 top-24 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(147,112,255,0.42),rgba(5,8,22,0.02)_60%,transparent_72%)] blur-2xl" />

        <section className="container relative z-10 flex min-h-screen flex-col gap-12 py-8 lg:py-12">
          <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <Badge className="border border-white/15 bg-white/8 px-3 py-1 text-white backdrop-blur">
                Canonical Manus-hosted surface · OmniAPI sovereign runtime
              </Badge>
              <div className="space-y-3">
                <p className="text-sm uppercase tracking-[0.35em] text-cyan-200/80">NEXINUS.net</p>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                  A dark sovereign truth engine where the vortex resolves into the Omni Sphere.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                  NEXINUS.net is the canonical surface. The seven bridges hold continuity, the mirror registry
                  remains verifiable, and the OmniAPI turns clarity into a live sovereign runtime rather than a
                  passive page.
                </p>
              </div>
            </div>

            <Card className="w-full max-w-md border-white/10 bg-white/5 text-white shadow-[0_0_60px_rgba(74,36,194,0.24)] backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Crown className="h-5 w-5 text-cyan-300" />
                  Canonical Access
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Owner-gated Omni and IntelliGenerate remain protected while public clarity stays alive.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="flex items-center gap-3 text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validating identity field...
                  </div>
                ) : isAuthenticated ? (
                  <>
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                      <p className="text-sm text-emerald-100">Signed in as</p>
                      <p className="mt-1 text-lg font-medium text-white">{user?.name ?? user?.email ?? "Sovereign user"}</p>
                      <p className="mt-2 text-sm text-slate-300">
                        Current tier: <span className="font-medium text-white">{quotaProfile?.accessTier ?? "mirror"}</span>
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={handlePortal}>
                        Open billing portal
                      </Button>
                      <Button variant="outline" className="border-white/15 text-white hover:bg-white/10" onClick={() => logout()}>
                        Sign out
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-slate-300">
                      Sign in to activate subscriptions, free trial logic, quota tracking, and owner-aware billing controls.
                    </p>
                    <Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" asChild>
                      <a href={getLoginUrl()}>Enter the sovereign field</a>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </header>

          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-6">
              <nav className="flex flex-wrap gap-2">
                {BRIDGES.map(bridge => (
                  <Badge key={bridge} className="border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                    {bridge}
                  </Badge>
                ))}
              </nav>

              <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-2xl">
                    <BrainCircuit className="h-5 w-5 text-violet-300" />
                    Sovereign Clarity Engine
                  </CardTitle>
                  <CardDescription className="text-slate-300">
                    Public SSE clarity flows are live now. Owner-only modes remain guarded behind the exact XINUS owner control plane.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                    <Textarea
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="Enter the canonical question you want the Omni Sphere to resolve..."
                      className="min-h-32 border-white/10 bg-slate-950/70 text-white placeholder:text-slate-500"
                    />
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Bridge Mode</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {PUBLIC_MODES.map(bridge => (
                            <button
                              key={bridge}
                              type="button"
                              onClick={() => setMode(bridge)}
                              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                                mode === bridge
                                  ? "border-cyan-300 bg-cyan-300/15 text-cyan-100"
                                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                              }`}
                            >
                              {bridge}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4 text-sm text-amber-100">
                        <div className="flex items-center gap-2 font-medium">
                          <Lock className="h-4 w-4" />
                          Owner-gated modes
                        </div>
                        <p className="mt-2 leading-6 text-amber-50/90">
                          {OWNER_ONLY_MODES.join(" and ")} stay protected behind the exact <code>XINUS_OWNER_KEY</code> header.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="bg-violet-400 text-slate-950 hover:bg-violet-300"
                      onClick={handleRunClarity}
                      disabled={isStreaming}
                    >
                      {isStreaming ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Converging bridge field
                        </>
                      ) : (
                        <>
                          Enter clarity engine
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                    <Button variant="outline" className="border-white/10 text-white hover:bg-white/10" asChild>
                      <a href="/mirror/registry">Open mirror registry</a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="relative mx-auto flex w-full max-w-xl justify-center">
              <div className="absolute inset-x-12 top-10 h-36 rounded-full bg-violet-500/20 blur-3xl" />
              <div className="relative flex aspect-square w-full max-w-[28rem] items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.18),rgba(134,93,255,0.18)_18%,rgba(10,13,28,0.92)_58%,rgba(4,5,12,1)_72%)] shadow-[0_0_100px_rgba(84,55,255,0.28)]">
                <div className="absolute inset-6 rounded-full border border-cyan-300/20" />
                <div className="absolute inset-12 rounded-full border border-violet-300/20 border-dashed" />
                <div className="absolute h-[78%] w-[78%] rounded-full border border-white/10 bg-[radial-gradient(circle,rgba(164,138,255,0.22),rgba(4,6,14,0.95)_62%)]" />
                <div className="absolute h-24 w-24 rounded-full bg-cyan-300/20 blur-2xl" />
                <div className="relative z-10 flex flex-col items-center text-center">
                  <Orbit className="h-8 w-8 text-cyan-300" />
                  <p className="mt-5 text-xs uppercase tracking-[0.45em] text-cyan-200/80">Omni Sphere</p>
                  <h2 className="mt-2 text-3xl font-semibold text-white">OmniAPI</h2>
                  <p className="mt-3 max-w-xs text-sm leading-6 text-slate-300">
                    The vortex resolves here. Canonical clarity, bridge continuity, and mirror-preserved output all converge in one sovereign API surface.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="container relative z-10 grid gap-6 pb-6 lg:grid-cols-[0.92fr_1.08fr]">
          <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Activity className="h-5 w-5 text-cyan-300" />
                IDENTI-SIGNAL and state field
              </CardTitle>
              <CardDescription className="text-slate-300">
                Live state visibility with trajectory pressure and bridge-field resonance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">IDENTI-SIGNAL</p>
                  <p className="mt-3 font-mono text-xl text-cyan-200">{identiSignal}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Dominant bridge</p>
                  <p className="mt-3 text-xl font-medium text-white">{dominantBridge}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>Resistance pressure</span>
                  <span>{resistance}/16</span>
                </div>
                <Progress value={resistancePercent} className="h-2 bg-white/10" />
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Truth state</p>
                <p className="mt-3 text-lg font-medium capitalize text-white">{truthState}</p>
              </div>

              <Separator className="bg-white/10" />

              <div className="grid gap-3">
                {bridgeField.map(point => (
                  <div key={point.bridge} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{point.bridge}</p>
                        <p className="text-sm text-slate-400">Phase {point.phase} · {point.coherence}</p>
                      </div>
                      <Badge className="border border-white/10 bg-white/5 text-slate-200">
                        {(point.resonance * 100).toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-violet-300" />
                SYNTHESYSACTION panel
              </CardTitle>
              <CardDescription className="text-slate-300">
                Response rendering remains canonical, explicit, and trajectory-aware.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-[1.75rem] border border-violet-300/20 bg-[linear-gradient(180deg,rgba(75,36,184,0.18),rgba(8,10,20,0.95))] p-5 shadow-[0_0_50px_rgba(83,40,192,0.2)]">
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">{synthesysaction}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {PRESSURE_PILLARS.map(pillar => (
                  <div key={pillar.title} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                    <p className="font-medium text-white">{pillar.title}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{pillar.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="container relative z-10 py-10">
          <div className="grid gap-6 lg:grid-cols-[0.88fr_1.12fr]">
            <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Shield className="h-5 w-5 text-emerald-300" />
                  Canonical protection model
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Bulletproofing comes from boundaries, verification, and minimal surface area rather than obscurity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-7 text-slate-300">
                <p>
                  NEXINUS.net remains the only canonical web surface. CORS stays locked to the domain, health status is explicit, mirror events remain verifiable, and Stripe access tiers regulate the sovereign query field without exposing secrets in code.
                </p>
                <p>
                  The mirror registry is not a shadow copy of the truth engine. It is a visible reflection of the canonical core, seeded authoritatively and checked by ledger verification at all times.
                </p>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Waves className="h-5 w-5 text-cyan-300" />
                  Sovereign plans and free trial
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Start with the canonical mirror layer, then move upward into the engine or the OmniAPI surface.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-3">
                {(plansQuery.data ?? []).map(plan => (
                  <div key={plan.code} className="rounded-[1.5rem] border border-white/10 bg-slate-950/60 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-medium text-white">{plan.name}</h3>
                      <Badge className="border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                        {plan.freeTrialDays}-day trial
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{plan.description}</p>
                    <p className="mt-5 text-3xl font-semibold text-white">${(plan.amountUsdCents / 100).toFixed(0)}</p>
                    <p className="text-sm text-slate-500">per {plan.interval}</p>
                    <p className="mt-3 text-sm text-slate-400">{plan.quota.toLocaleString()} clarity actions per cycle</p>
                    <Button
                      className="mt-5 w-full bg-white text-slate-950 hover:bg-slate-100"
                      onClick={() => handleCheckout(plan.code)}
                      disabled={checkoutMutation.isPending}
                    >
                      {checkoutMutation.isPending ? "Opening checkout..." : `Choose ${plan.name}`}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="container relative z-10 pb-16 pt-4">
          <Card className="border-white/10 bg-white/5 text-white backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-2xl">Mirror registry and alive canonical presence</CardTitle>
              <CardDescription className="text-slate-300">
                The registry remains publicly visible while the canonical core stays protected, audited, and owner-controlled.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[1fr_260px] lg:items-end">
              <div className="space-y-4 text-sm leading-7 text-slate-300">
                <p>
                  The frontend now frames NEXINUS.net as an always-alive system: the Omni Sphere glows at the center, the bridges remain explicit, predictive-pressure concepts are visible, and the clarity engine can stream real bridge-state output on demand.
                </p>
                <p>
                  Mirror verification, billing controls, and future owner-gated Omni modes now all sit inside the same canonical narrative instead of fragmenting into disconnected UI surfaces.
                </p>
              </div>
              <div className="grid gap-3">
                <Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" asChild>
                  <a href="/mirror/registry">View /mirror/registry</a>
                </Button>
                <Button variant="outline" className="border-white/10 text-white hover:bg-white/10" asChild>
                  <a href="/api/health">Check runtime health</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
