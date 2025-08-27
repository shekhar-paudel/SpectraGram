"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

/** ---- API ---- */
type AccuracyApi = {
  ids: string[];
  langs: string[];
  metrics: Array<{
    name: string; // "WER", "WA"
    models: Array<{ id: string; exists: boolean; values: Record<string, number> }>;
  }>;
};

async function fetchAccuracy(ids: string[], signal?: AbortSignal): Promise<AccuracyApi> {
  const params = new URLSearchParams();
  params.set("ids", ids.join(","));
  const res = await fetch(`/api/model_benchmark_accuracy?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`accuracy api failed: ${res.status}`);
  return res.json();
}

/** ---- helpers ---- */
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

function shortId(id: string) {
  const parts = id.split("_");
  return parts.slice(-2).join("_");
}

/** ---- component ---- */
export default function AccuracyEvaulation({ ids }: { ids: string[] }) {
  const [payload, setPayload] = React.useState<AccuracyApi | null>(null);
  const [activeMetric, setActiveMetric] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
  if (!ids.length) { setPayload(null); setActiveMetric(null); return; }

  const controller = new AbortController();
  let active = true;

  (async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAccuracy(ids, controller.signal);
      if (!active) return;
      setPayload(data);
      setActiveMetric((m) =>
        data.metrics.find(mm => mm.name === m) ? m : (data.metrics[0]?.name ?? null)
      );
    } catch (e: any) {
      if (e?.name === "AbortError" || /aborted/i.test(e?.message)) return;
      if (!active) return;
      setError(e?.message ?? "Failed to load accuracy metrics");
      setPayload(null);
      setActiveMetric(null);
    } finally {
      if (active) setLoading(false);
    }
  })();

  return () => {
    active = false;
    controller.abort();
  };
}, [ids]);

  const chartData = React.useMemo(() => {
    if (!payload || !activeMetric) return [];
    const metric = payload.metrics.find((m) => m.name === activeMetric);
    if (!metric) return [];

    const models = metric.models;
    const langs = payload.langs;

    // Build rows: one row per language
    const rows = langs.map((lang) => {
      const row: Record<string, any> = { language: lang };
      models.forEach((m) => {
        const label = shortId(m.id);
        row[label] = m.values?.[lang] ?? null;
      });
      return row;
    });
    return rows;
  }, [payload, activeMetric]);

  const seriesMeta = React.useMemo(() => {
  if (!payload || !activeMetric) return [];
  const metric = payload.metrics.find((m) => m.name === activeMetric);
  if (!metric) return [];
  // keep short keys in data, show full id in legend
  return metric.models.map((m, i) => ({
    key: shortId(m.id),                 // matches keys you put in chartData rows
    name: m.id,                         // full model id for legend & tooltip
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}, [payload, activeMetric]);


  const seriesLabels = React.useMemo(() => {
    if (!payload || !activeMetric) return [];
    const metric = payload.metrics.find((m) => m.name === activeMetric);
    if (!metric) return [];
    return metric.models.map((m) => shortId(m.id));
  }, [payload, activeMetric]);

  return (
    <Card className="w-full">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Accuracy Evaluation</CardTitle>
        <Tabs value={activeMetric ?? ""} onValueChange={(v) => setActiveMetric(v)}>
          <TabsList>
            {(payload?.metrics ?? []).map((m) => (
              <TabsTrigger key={m.name} value={m.name}>
                {m.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="h-[360px]">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : !payload || !activeMetric ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No metrics available.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="language" />
              <YAxis />
              <Tooltip />
             <Legend
  align="left"
  verticalAlign="bottom"
  layout="horizontal"
  wrapperStyle={{
    width: "100%",
    textAlign: "left",
    whiteSpace: "normal", // allow wrapping for long IDs
    paddingLeft: 8,
  }}
/>
{seriesMeta.map((s) => (
  <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} />
))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
