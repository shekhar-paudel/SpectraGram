"use client";

import * as React from "react";

/* shadcn-ui */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/* Icons */
import { Crown } from "lucide-react";

/* ---------------------------- API types & fetch ---------------------------- */
type LeaderboardApi = {
  ids: string[];
  langs: string[]; // e.g., ["en"]
  metrics: Array<{
    name: "WER" | "RTF" | "LatencyMs" | "ResponseLatencyMs";
    models: Array<{
      id: string;
      exists: boolean;
      values: Record<string, number | null | undefined>; // {"en": value}
      ranks?: Record<string, number | null | undefined>; // {"en": 1}
    }>;
  }>;
};

async function fetchLeaderboard(signal?: AbortSignal): Promise<LeaderboardApi> {
  const res = await fetch("/api/model_leaderboard", { signal });
  if (!res.ok) throw new Error(`leaderboard api failed: ${res.status}`);
  return res.json();
}

/* --------------------------------- helpers -------------------------------- */
const METRICS: Array<LeaderboardApi["metrics"][number]["name"]> = [
  "WER",
  "RTF",
  "LatencyMs",
  "ResponseLatencyMs",
];

const LOWER_IS_BETTER = new Set(METRICS);

function fmtValue(metric: string, v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  if (metric === "LatencyMs" || metric === "ResponseLatencyMs") {
    return Math.round(v).toLocaleString(); // ms
  }
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/** Subsequence fuzzy match: "dg n3" → "deepgram_nova-3_2025-08" */
function fuzzyIncludes(target: string, query: string) {
  const t = target.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

/* ------------------------------ Metric Table ------------------------------ */
function MetricTableCard({
  title,
  lang,
  models,
  gradientClass,
}: {
  title: LeaderboardApi["metrics"][number]["name"];
  lang: string;
  models: LeaderboardApi["metrics"][number]["models"];
  gradientClass: string;
}) {
  const [query, setQuery] = React.useState("");

  const rows = React.useMemo(() => {
    const base = models.map((m) => ({
      id: m.id,
      value: (m.values?.[lang] ?? null) as number | null,
      rank: (m.ranks?.[lang] ?? null) as number | null,
    }));

    const filtered = query.trim() ? base.filter((r) => fuzzyIncludes(r.id, query)) : base;

    const haveRanks = filtered.some((r) => r.rank != null);
    if (haveRanks) {
      return filtered
        .filter((r) => r.rank != null)
        .sort((a, b) => (a.rank! - b.rank!));
    }
    return filtered
      .slice()
      .sort((a, b) => {
        const av = a.value, bv = b.value;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv; // lower is better
      })
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [models, lang, query]);

  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl p-[1px] ring-1 ring-border/40",
        gradientClass,
      ].join(" ")}
    >
      {/* inner glass layer */}
      <Card className="relative rounded-[calc(1rem-1px)] border-0 bg-background/70 shadow-sm backdrop-blur supports-[backdrop-filter]:backdrop-blur">
        {/* header with per-table fuzzy search */}
        <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-0.5">
            {/* Title: Metric - Leaderboard */}
            <h3 className="text-base font-semibold">{title} - Leaderboard</h3>
            <div className="text-xs text-muted-foreground/80">Language: {lang}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-background/70">
              {LOWER_IS_BETTER.has(title) ? "Lower is better" : "Higher is better"}
            </Badge>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-[220px]"
            />
          </div>
        </div>

        {/* scrollable table */}
        <div className="mt-3 max-h-96 overflow-auto px-2 pb-4">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No data</div>
          ) : (
            <Table className="rounded-md">
              <TableHeader className="sticky top-0 z-10 bg-background/90 backdrop-blur">
                <TableRow>
                  <TableHead className="w-[64px]">Rank</TableHead>
                  <TableHead>Model ID</TableHead>
                  <TableHead className="w-[140px] text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isTop = r.rank === 1;
                  return (
                    <TableRow
                      key={`${title}-${lang}-${r.id}`}
                      className={isTop ? "bg-[var(--color-chart-1)]/10" : ""}
                    >
                      <TableCell className="font-medium">
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/40 text-xs tabular-nums">
                            {r.rank ?? "—"}
                          </span>
                          {isTop && <Crown className="h-4 w-4 text-[var(--color-chart-1)]" />}
                        </div>
                      </TableCell>
                      <TableCell className="truncate">{r.id}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtValue(title, r.value)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Page Component ----------------------------- */
export default function ModelLeaderboardVerticalTables() {
  const [payload, setPayload] = React.useState<LeaderboardApi | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [lang, setLang] = React.useState<string>("en");

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchLeaderboard(controller.signal);
        if (!active) return;
        setPayload(data);
        // initialize language dropdown from backend (fallback to "en")
        const firstLang = data.langs?.[0] ?? "en";
        setLang(firstLang);
      } catch (e: any) {
        if (e?.name !== "AbortError") setError(e?.message || "Failed to load leaderboard");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !payload) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const metricMap = new Map<
    LeaderboardApi["metrics"][number]["name"],
    LeaderboardApi["metrics"][number]["models"]
  >();
  payload.metrics.forEach((m) => metricMap.set(m.name, m.models));

  // Distinct gradients per table card
  const gradients = [
    "bg-gradient-to-br from-[var(--color-chart-1)]/35 via-[color-mix(in_oklch,var(--color-chart-1)_15%,transparent)] to-[var(--color-chart-3)]/35",
    "bg-gradient-to-br from-[var(--color-chart-4)]/35 via-[color-mix(in_oklch,var(--color-chart-4)_15%,transparent)] to-[var(--color-chart-2)]/35",
    "bg-gradient-to-br from-[var(--color-chart-6)]/35 via-[color-mix(in_oklch,var(--color-chart-6)_15%,transparent)] to-[var(--color-chart-3)]/35",
    "bg-gradient-to-br from-[var(--color-chart-5)]/35 via-[color-mix(in_oklch,var(--color-chart-5)_15%,transparent)] to-[var(--color-chart-2)]/35",
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Global controls: Language dropdown */}
      <div className="mb-1 flex items-center justify-end gap-2">
        <div className="text-xs text-muted-foreground">Language</div>
        <Select value={lang} onValueChange={(v) => setLang(v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            {(payload.langs?.length ? payload.langs : ["en"]).map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Four vertically stacked metric tables */}
      {METRICS.map((name, i) => (
        <MetricTableCard
          key={name}
          title={name}
          lang={lang}
          models={metricMap.get(name) ?? []}
          gradientClass={gradients[i] ?? gradients[gradients.length - 1]}
        />
      ))}
    </div>
  );
}
