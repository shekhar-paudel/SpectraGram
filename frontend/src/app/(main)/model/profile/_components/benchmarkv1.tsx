"use client";

import * as React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar,
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
  label: string;
  dataset_id: number;
  dataset_name: string;
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

type MetricShape = {
  series: { label: string; key: string }[];
  data: any[];
  subsets: string[];
};

type DatasetOption = { key: string; label: string };

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

/** Collect dataset options (key = internal id/key, label = friendly name) */
function collectDatasetOptions(payload: ProviderBucket[]): DatasetOption[] {
  const map = new Map<string, string>(); // key -> label

  if (!payload) return [];

  for (const b of payload) {
    if (isNewShape(b)) {
      for (const key of Object.keys(b.datasets)) {
        const rows = b.datasets[key] || [];
        const friendly =
          rows[0]?.dataset_name ||
          key; // fallback to key if name missing
        // keep the first non-placeholder name we see
        if (!map.has(key) || /^dataset_\d+$/i.test(map.get(key)!)) {
          map.set(key, friendly);
        }
      }
    } else {
      // old shape: group by dataset_id
      const byId = new Map<number, string>();
      for (const r of (b as ProviderBucketOld).results) {
        const key = String(r.dataset_id);
        const label = r.dataset_name || `dataset_${r.dataset_id}`;
        if (!map.has(key) || /^dataset_\d+$/i.test(map.get(key)!)) {
          map.set(key, label);
        }
        byId.set(r.dataset_id, label);
      }
    }
  }

  const options = Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  // sort by label, case-insensitive, numeric-aware
  options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }));
  return options;
}

/** Fetch rows for a dataset by INTERNAL KEY */
function rowsForBucket(b: ProviderBucket, datasetKey: string): SummaryRow[] {
  if (isNewShape(b)) {
    return b.datasets[datasetKey] ?? [];
  }
  const want = datasetKey; // old shape uses string(dataset_id) as key
  return (b as ProviderBucketOld).results.filter((r) => String(r.dataset_id) === want);
}

function makeUniqueKey(name: string, used: Set<string>) {
  let k = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (k === "") k = "series";
  const base = k;
  let i = 1;
  while (used.has(k)) k = `${base}_${i++}`;
  used.add(k);
  return k;
}

/** Series = MODELS (disambiguate duplicates as "Model (Provider)") */
function shapeForMetricByModel(
  buckets: ProviderBucket[],
  datasetKey: string,
  pick: (r: SummaryRow) => { value: number | undefined; lo: number | undefined; hi: number | undefined }
): MetricShape {
  const all: Array<{ provider: string; model: string; subset: string; value?: number; lo?: number; hi?: number }> = [];
  for (const bucket of buckets) {
    const rows = rowsForBucket(bucket, datasetKey);
    for (const r of rows) {
      all.push({ provider: r.provider, model: r.model, subset: subsetFromLabel(r.label), ...pick(r) });
    }
  }

  const modelCounts = new Map<string, number>();
  for (const a of all) modelCounts.set(a.model, 1 + (modelCounts.get(a.model) ?? 0));

  const seriesLabels: string[] = [];
  const seenLabel = new Set<string>();
  for (const a of all) {
    const lbl = (modelCounts.get(a.model)! > 1) ? `${a.model} (${a.provider})` : a.model;
    if (!seenLabel.has(lbl)) { seenLabel.add(lbl); seriesLabels.push(lbl); }
  }

  const used = new Set<string>();
  const keyForLabel = new Map<string, string>();
  for (const lbl of seriesLabels) keyForLabel.set(lbl, makeUniqueKey(lbl, used));

  const perSubset: Map<string, Record<string, any>> = new Map();
  for (const a of all) {
    const lbl = (modelCounts.get(a.model)! > 1) ? `${a.model} (${a.provider})` : a.model;
    const key = keyForLabel.get(lbl)!;
    const row = perSubset.get(a.subset) ?? { subset: a.subset };
    const err95 = errFromCI(a.value, a.lo, a.hi);
    row[`${key}_val`] = a.value;
    row[`${key}_err95`] = err95;
    row[`${key}_err50`] = scaleErr(err95, CI50_SCALE);
    perSubset.set(a.subset, row);
  }

  const present = Array.from(perSubset.keys());
  const ordered = [
    ...SUBSET_ORDER.filter((s) => present.includes(s)),
    ...present.filter((s) => !SUBSET_ORDER.includes(s)).sort(),
  ];
  const data = ordered.map((s) => perSubset.get(s)!);
  const series = seriesLabels.map((label) => ({ label, key: keyForLabel.get(label)! }));
  return { series, data, subsets: ordered };
}

/** ---------- UI Pieces ---------- */
const ChartCard: React.FC<{ title: string; controls?: React.ReactNode; children: React.ReactNode }> = ({ title, controls, children }) => (
  <Card className="w-full h-full from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs">
    <CardHeader className="pb-2 items-center text-center">
      <CardTitle className="m-0 text-sm sm:text-base">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      {controls ? <div className="mb-3">{controls}</div> : null}
      <div className="w-full h-[220px] sm:h-[280px] md:h-[340px] lg:h-[380px] xl:h-[440px]">{children}</div>
    </CardContent>
  </Card>
);

function ExplainerCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="w-full h-full from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm sm:text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="prose prose-sm dark:prose-invert max-w-none">
        {children}
      </CardContent>
    </Card>
  );
}

function ModelToggleLegend({
  allLabels, active, onToggle, colorIndexOf,
}: {
  allLabels: string[]; active: Set<string>; onToggle: (label: string) => void; colorIndexOf: (label: string) => number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allLabels.map((label) => {
        const enabled = active.has(label);
        const i = colorIndexOf(label);
        return (
          <Button
            key={label}
            size="sm"
            variant={enabled ? "secondary" : "outline"}
            onClick={() => onToggle(label)}
            className="h-8 px-3"
            style={{ background: enabled ? colorForIndex(i) : undefined, color: enabled ? "white" : undefined, borderColor: enabled ? "transparent" : undefined }}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}

function CiToggle({ mode, onChange }: { mode: "95" | "50"; onChange: (m: "95" | "50") => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">CI:</span>
      <Button size="sm" variant={mode === "95" ? "secondary" : "outline"} className="h-8 px-3" onClick={() => onChange("95")}>95%</Button>
      <Button size="sm" variant={mode === "50" ? "secondary" : "outline"} className="h-8 px-3" onClick={() => onChange("50")}>50%</Button>
    </div>
  );
}

/** Dataset toggle that shows LABELS but returns KEYS */
function DatasetToggle({
  options,
  value,
  onChange,
}: {
  options: DatasetOption[];
  value: string;              // current datasetKey
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Dataset:</span>
      {options.map((opt) => (
        <Button
          key={opt.key}
          size="sm"
          variant={value === opt.key ? "secondary" : "outline"}
          className="h-8 px-3"
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

function ClusteredBars({
  data, series, activeLabels, ciMode, yLabel, yTickFormatter,
}: {
  data: any[]; series: { label: string; key: string }[]; activeLabels: Set<string>; ciMode: "95" | "50"; yLabel: string; yTickFormatter?: (v: number) => string;
}) {
  const colorIndexOf = (label: string) => series.findIndex((s) => s.label === label);
  const enabled = series.filter((s) => activeLabels.has(s.label));
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={100}>
      <BarChart data={data} margin={{ left: 12, right: 12, top: 8, bottom: 28 }} barGap={0} barCategoryGap="22%">
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="subset" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={36} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={60}
          tickFormatter={yTickFormatter}
          label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 8, style: { fontSize: 12, fill: "hsl(var(--muted-foreground))" } }}
        />
        <Tooltip
          formatter={(value: any, _name: any, entry: any) => {
            const datum = entry?.payload ?? {};
            const s = series.find((ss) => `${ss.key}_val` === entry.dataKey);
            const label = s?.label ?? _name;
            const errKey = `${s?.key}_err${ciMode}`;
            const err = errKey ? datum[errKey] : undefined;
            if (Array.isArray(err)) {
              const [lo, hi] = err;
              return [`${value}`, `${label} (± ${Number(lo).toFixed(3)}/${Number(hi).toFixed(3)})`];
            }
            return [value, label];
          }}
        />
        {enabled.map((s) => {
          const i = colorIndexOf(s.label);
          return (
            <Bar key={s.key} dataKey={`${s.key}_val`} name={s.label} fill={colorForIndex(i)} radius={[2, 2, 0, 0]}>
              <ErrorBar dataKey={`${s.key}_err${ciMode}` as any} width={4} strokeWidth={1.5} />
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
/** ---------- Metric Explainers ---------- */
function WerExplainer({
  datasetLabel,
  ciMode,
}: {
  datasetLabel: string;
  ciMode: "95" | "50";
}) {
  return (
    <ExplainerCard title={`What is WER (Word Error Rate)?`}>
      <ul className="list-disc pl-5">
        <li>
          <strong>What you’re seeing:</strong> Bars show each <em>model’s</em>{" "}
          <strong>corpus-level WER</strong> per <strong>dataset/variant</strong>
          {datasetLabel ? <> (“{datasetLabel}”)</> : null}; error bars show the{" "}
          {ciMode}% CI.
        </li>
        <li>
          <strong>Lower is better.</strong> WER combines{" "}
          <strong>S</strong>ubstitutions, <strong>D</strong>eletions, and{" "}
          <strong>I</strong>nsertions.
        </li>
      </ul>

      <hr className="my-3" />

      <p className="m-0">
        <strong>Definition (corpus WER)</strong>
      </p>
      <pre className="whitespace-pre-wrap text-xs p-2 rounded-md bg-muted/50">
{`WER = (S + D + I) / N

Where:
  S = total substitutions
  D = total deletions
  I = total insertions
  N = total reference words (across all utterances)`}
      </pre>

      <p className="mt-3">
        <strong>How the CI is computed</strong>
      </p>
      <ul className="list-disc pl-5">
        <li>
          Percentile <strong>bootstrap over utterances</strong> (default{" "}
          <strong>1,000</strong> resamples) on corpus WER.
        </li>
        <li>
          CI toggle: if a <strong>50%</strong> bootstrap CI is available, we
          use it (25th/75th percentiles of the bootstrap stats); otherwise, we
          approximate 50% by scaling the stored 95% half-width by ~
          <code>0.344×</code> (normal approximation).
        </li>
      </ul>
    </ExplainerCard>
  );
}

function LatencyExplainer({
  datasetLabel,
  ciMode,
}: {
  datasetLabel: string;
  ciMode: "95" | "50";
}) {
  return (
    <ExplainerCard title={`Latency (P50)`}>
      <ul className="list-disc pl-5">
        <li>
          <strong>What you’re seeing:</strong> Bars show{" "}
          <strong>median (p50) end-to-end latency</strong> in milliseconds per{" "}
          <strong>dataset/variant</strong>
          {datasetLabel ? <> (“{datasetLabel}”)</> : null} and model; error bars
          show the {ciMode}% CI.
        </li>
        <li>
          <strong>Lower is better.</strong> P50 is robust to outliers compared
          to the mean.
        </li>
      </ul>

      <hr className="my-3" />

      <p className="m-0">
        <strong>Definition</strong>
      </p>
      <pre className="whitespace-pre-wrap text-xs p-2 rounded-md bg-muted/50">
{`Latency P50 = the 50th percentile of {total_time_ms} over utterances`}
      </pre>

      <p className="mt-3">
        <strong>How the CI is computed</strong>
      </p>
      <ul className="list-disc pl-5">
        <li>
          Percentile <strong>bootstrap on the median</strong> (default{" "}
          <strong>1,000</strong> iterations).
        </li>
        <li>
          For small sample sizes, upstream may also record a{" "}
          <em>distribution-free</em> <strong>order-statistic CI</strong> for the
          median; if present, it is shown alongside/used.
        </li>
        <li>
          CI toggle: prefer the stored <strong>50%</strong> bootstrap CI when
          available; otherwise, approximate from 95% using a{" "}
          <em>normal-approximation</em> half-width scaling (~
          <code>0.344×</code>).
        </li>
      </ul>
    </ExplainerCard>
  );
}

function RtfExplainer({
  datasetLabel,
  ciMode,
}: {
  datasetLabel: string;
  ciMode: "95" | "50";
}) {
  return (
    <ExplainerCard title={`RTF (Real-Time Factor)`}>
      <ul className="list-disc pl-5">
        <li>
          <strong>What you’re seeing:</strong> Bars show{" "}
          <strong>mean RTF</strong> per <strong>dataset/variant</strong>
          {datasetLabel ? <> (“{datasetLabel}”)</> : null} and model; error bars
          show the {ciMode}% CI.
        </li>
        <li>
          <strong>Lower is better.</strong> <code>RTF &lt; 1</code> means faster
          than real-time; <code>RTF &gt; 1</code> means slower.
        </li>
      </ul>

      <hr className="my-3" />

      <p className="m-0">
        <strong>Definition</strong>
      </p>
      <pre className="whitespace-pre-wrap text-xs p-2 rounded-md bg-muted/50">
{`For each utterance i:
  RTF_i = (latency_i_ms / 1000) / duration_i_s

RTF_mean = mean over i of RTF_i`}
      </pre>

      <p className="mt-3">
        <strong>How the CI is computed</strong>
      </p>
      <ul className="list-disc pl-5">
        <li>
          Percentile <strong>bootstrap on the mean</strong> RTF (default{" "}
          <strong>1,000</strong> iterations).
        </li>
        <li>
          Tail behavior is captured separately by{" "}
          <strong>RTF p95</strong> (also bootstrapped) in your stored summaries.
        </li>
        <li>
          CI toggle: prefer the stored <strong>50%</strong> bootstrap CI when
          available; otherwise, approximate 50% from 95% using a{" "}
          <em>normal-approximation</em> half-width scaling (~
          <code>0.344×</code>).
        </li>
      </ul>
    </ExplainerCard>
  );
}

/** ---------- Main ---------- */
export default function BenchmarkV1({
  ids,
  extraControls,
}: {
  ids: string[];
  extraControls?: React.ReactNode;
}) {
  const [payload, setPayload] = React.useState<ProviderBucket[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [ciMode, setCiMode] = React.useState<"95" | "50">("95");

  // Use internal datasetKey for lookups, but compute a friendly datasetLabel for display
  const [datasetKey, setDatasetKey] = React.useState<string>("");
  const [datasetOptions, setDatasetOptions] = React.useState<DatasetOption[]>([]);

  // Per-chart active model sets
  const [activeModelsWER, setActiveModelsWER] = React.useState<Set<string>>(new Set());
  const [activeModelsLAT, setActiveModelsLAT] = React.useState<Set<string>>(new Set());
  const [activeModelsRTF, setActiveModelsRTF] = React.useState<Set<string>>(new Set());

  // Fetch data
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
        const opts = collectDatasetOptions(data);
        setDatasetOptions(opts);
        setDatasetKey((cur) => (opts.some(o => o.key === cur) ? cur : (opts[0]?.key ?? "")));
      })
      .catch((e) => {
        if ((e as any).name !== "AbortError") setError(String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [ids]);

  /** Friendly label for current dataset key */
  const datasetLabel = React.useMemo(() => {
    const found = datasetOptions.find(o => o.key === datasetKey);
    return found?.label ?? datasetKey ?? "";
  }, [datasetOptions, datasetKey]);

  /** ---- SHAPE METRICS WITH SAFE FALLBACKS ---- */
  const EMPTY: MetricShape = { series: [], data: [], subsets: [] };

  const mWER = React.useMemo<MetricShape>(() => {
    if (!payload || !datasetKey) return EMPTY;
    return shapeForMetricByModel(payload, datasetKey, (r) => ({ value: r.wer, lo: r.wer_ci_low, hi: r.wer_ci_high }));
  }, [payload, datasetKey]);

  const mLAT = React.useMemo<MetricShape>(() => {
    if (!payload || !datasetKey) return EMPTY;
    return shapeForMetricByModel(payload, datasetKey, (r) => ({ value: r.latency_p50_ms, lo: r.latency_p50_ms_ci_low, hi: r.latency_p50_ms_ci_high }));
  }, [payload, datasetKey]);

  const mRTF = React.useMemo<MetricShape>(() => {
    if (!payload || !datasetKey) return EMPTY;
    return shapeForMetricByModel(payload, datasetKey, (r) => ({ value: r.rtf_mean, lo: r.rtf_mean_ci_low, hi: r.rtf_mean_ci_high }));
  }, [payload, datasetKey]);

  // Labels for toggles
  const werLabels = React.useMemo(() => mWER.series.map((s) => s.label), [mWER.series]);
  const latLabels = React.useMemo(() => mLAT.series.map((s) => s.label), [mLAT.series]);
  const rtfLabels = React.useMemo(() => mRTF.series.map((s) => s.label), [mRTF.series]);

  // Reset per-chart toggles when dataset or shaped series change
  React.useEffect(() => { setActiveModelsWER(new Set(werLabels)); }, [datasetKey, werLabels.join("|")]);
  React.useEffect(() => { setActiveModelsLAT(new Set(latLabels)); }, [datasetKey, latLabels.join("|")]);
  React.useEffect(() => { setActiveModelsRTF(new Set(rtfLabels)); }, [datasetKey, rtfLabels.join("|")]);

  /** ---- EARLY RETURNS ---- */
  if (!ids || ids.length === 0) return null;

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader className="items-center text-center"><CardTitle>Benchmark</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground">Loading benchmark results…</div></CardContent>
      </Card>
    );
  }

  if (error || !payload || payload.length === 0 || !datasetKey) {
    return (
      <Card className="w-full">
        <CardHeader className="items-center text-center"><CardTitle>Benchmark</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-destructive">{error ? `Error: ${error}` : "No data returned."}</div></CardContent>
      </Card>
    );
  }

  const fmtMs = (v: number) => (v == null ? "" : `${Math.round(v)}`);
  const fmt3 = (v: number) => (v == null ? "" : v.toFixed(3));

  // Color index resolvers (stable per chart)
  const idxWER = (label: string) => mWER.series.findIndex((s) => s.label === label);
  const idxLAT = (label: string) => mLAT.series.findIndex((s) => s.label === label);
  const idxRTF = (label: string) => mRTF.series.findIndex((s) => s.label === label);

  return (
    <div className="w-full grid grid-cols-1 gap-6">
      {/* Controls row (Dataset + EXTRA + CI) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Dataset (labels shown, keys used) */}
        <DatasetToggle options={datasetOptions} value={datasetKey} onChange={setDatasetKey} />

        {/* Right: extra controls (multi-select) + CI */}
        <div className="flex items-center gap-3">
          {extraControls}
          <CiToggle mode={ciMode} onChange={setCiMode} />
        </div>
      </div>

      {/* WER */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="order-2 md:order-1"><WerExplainer datasetLabel={datasetLabel} ciMode={ciMode} /></div>
        <div className="order-1 md:order-2">
          <ChartCard
            title={`WER by subset (${datasetLabel})`}
            controls={
              <ModelToggleLegend
                allLabels={werLabels}
                active={activeModelsWER}
                onToggle={(label) => setActiveModelsWER((prev) => {
                  const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next;
                })}
                colorIndexOf={idxWER}
              />
            }
          >
            <ClusteredBars
              data={mWER.data}
              series={mWER.series}
              activeLabels={activeModelsWER}
              ciMode={ciMode}
              yLabel="WER"
              yTickFormatter={fmt3}
            />
          </ChartCard>
        </div>
      </div>

      {/* Latency P50 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="order-2 md:order-1"><LatencyExplainer datasetLabel={datasetLabel} ciMode={ciMode} /></div>
        <div className="order-1 md:order-2">
          <ChartCard
            title={`Latency P50 by subset (${datasetLabel})`}
            controls={
              <ModelToggleLegend
                allLabels={latLabels}
                active={activeModelsLAT}
                onToggle={(label) => setActiveModelsLAT((prev) => {
                  const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next;
                })}
                colorIndexOf={idxLAT}
              />
            }
          >
            <ClusteredBars
              data={mLAT.data}
              series={mLAT.series}
              activeLabels={activeModelsLAT}
              ciMode={ciMode}
              yLabel="ms"
              yTickFormatter={fmtMs}
            />
          </ChartCard>
        </div>
      </div>

      {/* RTF Mean */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="order-2 md:order-1"><RtfExplainer datasetLabel={datasetLabel} ciMode={ciMode} /></div>
        <div className="order-1 md:order-2">
          <ChartCard
            title={`RTF mean by subset (${datasetLabel})`}
            controls={
              <ModelToggleLegend
                allLabels={rtfLabels}
                active={activeModelsRTF}
                onToggle={(label) => setActiveModelsRTF((prev) => {
                  const next = new Set(prev); next.has(label) ? next.delete(label) : next.add(label); return next;
                })}
                colorIndexOf={idxRTF}
              />
            }
          >
            <ClusteredBars
              data={mRTF.data}
              series={mRTF.series}
              activeLabels={activeModelsRTF}
              ciMode={ciMode}
              yLabel="RTF"
              yTickFormatter={fmt3}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
