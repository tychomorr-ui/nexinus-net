import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

type MirrorRow = {
  tier: number;
  fullName: string;
  jurisdiction: string;
  office: string;
  sourceUrl: string;
  photoUrl: string | null;
};

type MirrorTierGroup = {
  tier: number;
  rows: MirrorRow[];
};

type LedgerVerification = {
  ok: boolean;
  eventCount: number;
  latestHash?: string | null;
};

const REQUIRED_TIERS = [100, 90, 80, 70, 40] as const;

export default function MirrorRegistry() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tiers, setTiers] = useState<MirrorTierGroup[]>([]);
  const [ledger, setLedger] = useState<LedgerVerification | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const [registryResponse, ledgerResponse] = await Promise.all([
          fetch("/api/xinus/mirror/registry"),
          fetch("/mirror/ledger/verify"),
        ]);

        if (!registryResponse.ok) {
          throw new Error("Mirror registry feed unavailable.");
        }

        const registryJson = (await registryResponse.json()) as {
          ok: boolean;
          tiers: MirrorTierGroup[];
        };
        const ledgerJson = ledgerResponse.ok
          ? ((await ledgerResponse.json()) as LedgerVerification)
          : null;

        if (!cancelled) {
          setTiers(registryJson.tiers ?? []);
          setLedger(ledgerJson);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load registry.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedTiers = useMemo(() => {
    const map = new Map<number, MirrorRow[]>();
    tiers.forEach(group => {
      map.set(group.tier, group.rows ?? []);
    });

    return REQUIRED_TIERS.map(tier => ({
      tier,
      rows: map.get(tier) ?? [],
    }));
  }, [tiers]);

  return (
    <div className="min-h-screen bg-[#040712] text-white">
      <main className="container py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-3">
            <Badge className="border border-white/10 bg-white/5 text-white">/mirror/registry</Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-white">Authoritative Mirror Registry</h1>
            <p className="max-w-3xl text-base leading-7 text-slate-300">
              This registry displays the canonical cohort across the required tiers 100, 90, 80, 70, and 40 while keeping ledger verification visible on the same surface.
            </p>
          </div>

          <Button variant="outline" className="border-white/10 text-white hover:bg-white/10" asChild>
            <a href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Return to NEXINUS
            </a>
          </Button>
        </div>

        <div className="mb-8 grid gap-4 lg:grid-cols-3">
          <Card className="border-white/10 bg-white/5 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-cyan-300" />
                Ledger verification
              </CardTitle>
              <CardDescription className="text-slate-300">
                Live verification state from the canonical ledger endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-3xl font-semibold text-white">{ledger?.ok ? "OK" : loading ? "…" : "Check"}</p>
              <p className="text-sm text-slate-400">Event count: {ledger?.eventCount ?? 0}</p>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5 text-white lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                Canonical visibility
              </CardTitle>
              <CardDescription className="text-slate-300">
                All rows remain visible and grouped by the authoritative tier headings required by NEXINUS.net.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-7 text-slate-300">
                Rows are grouped strictly by 100, 90, 80, 70, and 40. Empty tiers remain visible rather than disappearing, preserving the canonical layout even when a cohort segment is not yet seeded.
              </p>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <Card className="border-white/10 bg-white/5 text-white">
            <CardContent className="flex items-center gap-3 p-6 text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading authoritative registry rows...
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-red-400/30 bg-red-400/10 text-white">
            <CardContent className="p-6 text-sm leading-7 text-red-100">{error}</CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {normalizedTiers.map(group => (
              <Card key={group.tier} className="border-white/10 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-2xl">Tier {group.tier}</CardTitle>
                  <CardDescription className="text-slate-300">
                    {group.rows.length} canonical row{group.rows.length === 1 ? "" : "s"} visible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {group.rows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
                      No registry rows are seeded in this tier yet.
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {group.rows.map(row => (
                        <div key={`${group.tier}-${row.fullName}-${row.jurisdiction}`} className="rounded-2xl border border-white/10 bg-slate-950/50 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-lg font-medium text-white">{row.fullName}</p>
                              <p className="mt-1 text-sm text-slate-400">{row.office}</p>
                            </div>
                            <Badge className="border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">{row.jurisdiction}</Badge>
                          </div>
                          <div className="mt-4 text-sm text-slate-300">
                            <p>Tier: {row.tier}</p>
                            <p className="mt-1 break-all">Source: {row.sourceUrl}</p>
                          </div>
                          <Button variant="outline" className="mt-4 border-white/10 text-white hover:bg-white/10" asChild>
                            <a href={row.sourceUrl} target="_blank" rel="noreferrer">
                              View source
                            </a>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
