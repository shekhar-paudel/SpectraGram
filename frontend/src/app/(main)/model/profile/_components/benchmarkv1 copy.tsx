"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ErrorBar,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** ---------- Types ---------- */
type SummaryRow = {
  benchmark_id: string;
  job_run_id: number;
  provider: string;
  model: string;
  eval_version: string;
  label: string; // e.g. 'librispeech [snr_db=20, split=dev-clean, subset=snr20]'
  dataset_id: number;
  variant_id: number;
  n_utterances: number;
  wer: number;
  wer_ci_low: number;
  wer_ci_high: number;
  latency_p50_ms: number;
  latency_p50_ms_ci_low: number;
  latency_p50_ms_ci_high: number;
  latency_p95_ms: number;
  latency_p95_ms_ci_low: number;
  latency_p95_ms_ci_high: number;
  rtf_mean: number;
  rtf_mean_ci_low: number;
  rtf_mean_ci_high: number;
  rtf_p95: number;
  rtf_p95_ci_low: number;
  rtf_p95_ci_high: number;
};

type ProviderBucketOld = { provider: string; results: SummaryRow[] };
type ProviderBucketNew = { provider: string; datasets: Record<string, SummaryRow[]> };
type ProviderBucket = ProviderBucketOld | ProviderBucketNew;

/** ---------- Palette ---------- */
const PROVIDER_COLORS = [
  "var(--color-chart-1)","var(--color-chart-2)","var(--color-chart-3)","var(--color-chart-4)",
  "var(--color-chart-5)","var(--color-chart-6)","var(--color-chart-7)","var(--color-chart-8)",
  "var(--color-chart-9)","var(--color-chart-10)","var(--color-chart-11)","var(--color-chart-12)","var(--color-chart-13)",
];
const colorForIndex = (i: number) => PROVIDER_COLORS[i % PROVIDER_COLORS.length];

/** ---------- Helpers ---------- */
const isNewShape = (b: ProviderBucket): b is ProviderBucketNew =>
  (b as any)?.datasets && typeof (b as any).datasets === "object";

const subsetFromLabel = (label: string) => {
  const m = label.match(/subset=([^,\]]+)/);
  return m ? m[1] : label;
};

const errFromCI = (
  center?: number,
  lo?: number,
  hi?: number
): [number, number] | undefined => {
  if (center == null || lo == null || hi == null || Number.isNaN(center) || Number.isNaN(lo) || Number.isNaN(hi)) {
    return undefined;
  }
  return [Math.max(0, center - lo), Math.max(0, hi - center)];
};

// Scale 95% CI → ~50% CI (0.674/1.96 ≈ 0.344)
const CI50_SCALE = 0.344;
const scaleErr = (err?: [number, number], f: number = 1): [number, number] | undefined =>
  err ? [err[0] * f, err[1] * f] : undefined;

// Friendly subset order
const SUBSET_ORDER = ["clean", "tel8k", "snr20", "snr10", "snr0"];

/** Collect available dataset keys (strings like "1","2") from either shape */
function collectDatasetKeys(payload: ProviderBucket[]): string[] {
  const keys = new Set<string>();
  for (const b of payload) {
    if (isNewShape(b)) {
      Object.keys(b.datasets).forEach((k) => keys.add(k));
    } else {
      // derive from rows' dataset_id
      const seen = new Set<number>();
      for (const r of b.results) seen.add(r.dataset_id);
      for (const id of seen) keys.add(String(id));
    }
  }
  return Array.from(keys).sort((a, b) => Number(a) - Number(b));
}

/** Get rows for a specific dataset key from either shape */
function rowsForBucket(b: ProviderBucket, datasetKey: string): SummaryRow[] {
  if (isNewShape(b)) {
    return b.datasets[datasetKey] ?? [];
  }
  const want = Number(datasetKey);
  return b.results.filter((r) => r.dataset_id === want);
}

/** Data shaping for one metric (providers clustered per subset) */
function shapeForMetric(
  buckets: ProviderBucket[],
  datasetKey: string,
  pick: (r: SummaryRow) => { value: number | undefined; lo: number | undefined; hi: number | undefined }
) {
  const providers = buckets.map((b) => b.provider);
  const perSubset: Map<string, Record<string, any>> = new Map();

  for (const bucket of buckets) {
    const p = bucket.provider;
    const rows = rowsForBucket(bucket, datasetKey);
    for (const r of rows) {
      const subset = subsetFromLabel(r.label);
      const row = perSubset.get(subset) ?? { subset };
      const { value, lo, hi } = pick(r);
      const err95 = errFromCI(value, lo, hi);
      row[`${p}_val`] = value;
      row[`${p}_err95`] = err95;
      row[`${p}_err50`] = scaleErr(err95, CI50_SCALE);
      perSubset.set(subset, row);
    }
  }

  const present = Array.from(perSubset.keys());
  const ordered = [
    ...SUBSET_ORDER.filter((s) => present.includes(s)),
    ...present.filter((s) => !SUBSET_ORDER.includes(s)).sort(),
  ];

  const data = ordered.map((s) => perSubset.get(s)!);
  return { providers, data, subsets: ordered };
}

/** ---------- UI Pieces ---------- */const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Card className="w-full from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs">
    <CardHeader className="pb-2 items-center text-center">
      <CardTitle className="m-0 text-sm sm:text-base">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      {/* Responsive height by breakpoint; width always 100% */}
      <div className="w-full h-[220px] sm:h-[280px] md:h-[340px] lg:h-[380px] xl:h-[440px]">
        {children}
      </div>
    </CardContent>
  </Card>
);

function ProviderToggleLegend({
  allProviders,
  active,
  onToggle,
}: {
  allProviders: string[];
  active: Set<string>;
  onToggle: (p: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {allProviders.map((p, i) => {
        const enabled = active.has(p);
        return (
          <Button
            key={p}
            size="sm"
            variant={enabled ? "secondary" : "outline"}
            onClick={() => onToggle(p)}
            className="h-8 px-3"
            style={{
              background: enabled ? colorForIndex(i) : undefined,
              color: enabled ? "white" : undefined,
              borderColor: enabled ? "transparent" : undefined,
            }}
          >
            {p}
          </Button>
        );
      })}
    </div>
  );
}

function CiToggle({
  mode,
  onChange,
}: {
  mode: "95" | "50";
  onChange: (m: "95" | "50") => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">CI:</span>
      <Button size="sm" variant={mode === "95" ? "secondary" : "outline"} className="h-8 px-3" onClick={() => onChange("95")}>
        95%
      </Button>
      <Button size="sm" variant={mode === "50" ? "secondary" : "outline"} className="h-8 px-3" onClick={() => onChange("50")}>
        50%
      </Button>
    </div>
  );
}

function DatasetToggle({
  datasetKeys,
  value,
  onChange,
}: {
  datasetKeys: string[];
  value: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Dataset:</span>
      {datasetKeys.map((k) => (
        <Button
          key={k}
          size="sm"
          variant={value === k ? "secondary" : "outline"}
          className="h-8 px-3"
          onClick={() => onChange(k)}
        >
          {k}
        </Button>
      ))}
    </div>
  );
}

function ClusteredBars({
  data,
  providers,
  activeProviders,
  ciMode,
  yLabel,
  yTickFormatter,
}: {
  data: any[];
  providers: string[];
  activeProviders: Set<string>;
  ciMode: "95" | "50";
  yLabel: string;
  yTickFormatter?: (v: number) => string;
}) {
  const enabled = providers.filter((p) => activeProviders.has(p));

  return (
   <ResponsiveContainer width="100%" height="100%" debounce={100}>
    <BarChart
      data={data}
      margin={{ left: 12, right: 12, top: 8, bottom: 28 }}
      barGap={0}
      barCategoryGap="22%"
    >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="subset" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={36} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={60}
          tickFormatter={yTickFormatter}
          label={{
            value: yLabel,
            angle: -90,
            position: "insideLeft",
            offset: 8,
            style: { fontSize: 12, fill: "hsl(var(--muted-foreground))" },
          }}
        />
        <Tooltip
          formatter={(value: any, name: any, entry: any) => {
            const datum = entry?.payload ?? {};
            const errKey = `${name}_err${ciMode}`;
            const err = datum[errKey];
            if (Array.isArray(err)) {
              const [lo, hi] = err;
              return [`${value}`, `${name} (± ${Number(lo).toFixed(3)}/${Number(hi).toFixed(3)})`];
            }
            return [value, name];
          }}
        />
        {enabled.map((p, i) => (
          <Bar key={p} dataKey={`${p}_val`} name={p} fill={colorForIndex(i)} radius={[2, 2, 0, 0]}>
            <ErrorBar dataKey={`${p}_err${ciMode}` as any} width={4} strokeWidth={1.5} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** ---------- Main ---------- */
export default function BenchmarkV1({ ids }: { ids: string[] }) {
  const [payload, setPayload] = React.useState<ProviderBucket[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // UI state: providers, CI, dataset
  const [ciMode, setCiMode] = React.useState<"95" | "50">("95");
  const [activeProviders, setActiveProviders] = React.useState<Set<string>>(new Set());
  const [datasetKey, setDatasetKey] = React.useState<string>("1");
  const [datasetKeys, setDatasetKeys] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!ids || ids.length === 0) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams({ ids: ids.join(",") }).toString();
    fetch(`/api/model_benchmark_v1?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ProviderBucket[];
      })
      .then((data) => {
        setPayload(data);
        // providers
        setActiveProviders(new Set(data.map((d) => d.provider)));
        // datasets
        const keys = collectDatasetKeys(data);
        setDatasetKeys(keys);
        // keep current if valid; otherwise default to first
        setDatasetKey((cur) => (keys.includes(cur) ? cur : (keys[0] ?? "1")));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(String(e));
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [ids]);

  if (!ids || ids.length === 0) return null;

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <CardTitle>Benchmark v1</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading benchmark results…</div>
        </CardContent>
      </Card>
    );
  }

  if (error || !payload || payload.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <CardTitle>Benchmark v1</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            {error ? `Error: ${error}` : "No data returned."}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Shape metrics for selected dataset
  const mWER = shapeForMetric(payload, datasetKey, (r) => ({
    value: r.wer,
    lo: r.wer_ci_low,
    hi: r.wer_ci_high,
  }));
  const mLAT = shapeForMetric(payload, datasetKey, (r) => ({
    value: r.latency_p50_ms,
    lo: r.latency_p50_ms_ci_low,
    hi: r.latency_p50_ms_ci_high,
  }));
  const mRTF = shapeForMetric(payload, datasetKey, (r) => ({
    value: r.rtf_mean,
    lo: r.rtf_mean_ci_low,
    hi: r.rtf_mean_ci_high,
  }));

  const fmtMs = (v: number) => (v == null ? "" : `${Math.round(v)}`);
  const fmt3 = (v: number) => (v == null ? "" : v.toFixed(3));

  const allProviders = (payload ?? []).map((b) => b.provider);
  const toggleProvider = (p: string) =>
    setActiveProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <div className="w-full grid grid-cols-1 gap-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProviderToggleLegend allProviders={allProviders} active={activeProviders} onToggle={toggleProvider} />
        <div className="flex items-center gap-4">
          <DatasetToggle datasetKeys={datasetKeys} value={datasetKey} onChange={setDatasetKey} />
          <CiToggle mode={ciMode} onChange={setCiMode} />
        </div>
      </div>

      {/* WER */}
      <ChartCard title={`WER by subset (Dataset ${datasetKey})`}>
        <ClusteredBars
          data={mWER.data}
          providers={mWER.providers}
          activeProviders={activeProviders}
          ciMode={ciMode}
          yLabel="WER"
          yTickFormatter={fmt3}
        />
      </ChartCard>

      {/* Latency P50 */}
      <ChartCard title={`Latency P50 by subset (Dataset ${datasetKey})`}>
        <ClusteredBars
          data={mLAT.data}
          providers={mLAT.providers}
          activeProviders={activeProviders}
          ciMode={ciMode}
          yLabel="ms"
          yTickFormatter={fmtMs}
        />
      </ChartCard>

      {/* RTF mean */}
      <ChartCard title={`RTF mean by subset (Dataset ${datasetKey})`}>
        <ClusteredBars
          data={mRTF.data}
          providers={mRTF.providers}
          activeProviders={activeProviders}
          ciMode={ciMode}
          yLabel="RTF"
          yTickFormatter={fmt3}
        />
      </ChartCard>
    </div>
  );
}
