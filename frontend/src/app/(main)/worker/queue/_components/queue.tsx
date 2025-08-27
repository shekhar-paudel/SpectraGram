"use client";

import * as React from "react";

/* NextAdmin / shadcn-ui */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/* Icons */
import { Loader2, RotateCcw } from "lucide-react";

/* ---------------------------- API types & fetch ---------------------------- */

type JobRow = {
  model_id: string | null;
  job_type: string;
  status: "queued" | "processing" | "done" | "failed" | string;
  priority: number;
  run_at: string | null;       // ISO string or null
  attempts: number;
  last_error: string | null;
  created_at: string;          // ISO string
  updated_at: string;          // ISO string
};

type QueueApi = {
  jobs: JobRow[];
};

async function fetchQueue(limit: number, signal?: AbortSignal): Promise<QueueApi> {
  const res = await fetch(`/api/queue?limit=${encodeURIComponent(limit)}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`queue api failed: ${res.status}`);
  return res.json();
}

/* --------------------------------- helpers -------------------------------- */

const isAbortError = (e: any) =>
  e?.name === "AbortError" || /aborted/i.test(e?.message || "");

function fmt(dt: string | null) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt; // show raw if parse fails
  return d.toLocaleString();
}

/** Subsequence fuzzy match across a string */
function fuzzyIncludes(target: string, query: string) {
  const t = target.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

/** Row matches if any of these fields include the query (subsequence) */
function matches(row: JobRow, query: string) {
  if (!query.trim()) return true;
  const chunks = [
    row.model_id ?? "",
    row.job_type ?? "",
    row.status ?? "",
    String(row.priority ?? ""),
    row.last_error ?? "",
    row.run_at ?? "",
    row.created_at ?? "",
    row.updated_at ?? "",
  ].join(" | ");
  return fuzzyIncludes(chunks, query);
}

function StatusBadge({ status }: { status: JobRow["status"] }) {
  const s = (status || "").toLowerCase();
  if (s === "failed") return <Badge variant="destructive">failed</Badge>;
  if (s === "processing") return <Badge>processing</Badge>;
  if (s === "done") return <Badge variant="secondary">done</Badge>;
  return <Badge variant="outline">{status}</Badge>; // queued / other
}

/* -------------------------------- component -------------------------------- */

export default function JobQueueTable() {
  const [limit, setLimit] = React.useState<number>(10);
  const [query, setQuery] = React.useState("");
  const [payload, setPayload] = React.useState<QueueApi | null>(null);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchQueue(limit, signal);
      setPayload(data);
    } catch (e: any) {
      if (!isAbortError(e)) setError(e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    (async () => {
      await load(controller.signal);
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [load]);

  const rows = React.useMemo(() => {
    const list = payload?.jobs ?? [];
    const filtered = query.trim()
      ? list.filter((j) => matches(j, query))
      : list;
    // API already returns newest first; keep order as-is
    return filtered;
  }, [payload, query]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      {/* Soft full-container gradient using your theme tokens */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--color-chart-6)]/20 via-[var(--color-chart-3)]/10 to-[var(--color-chart-1)]/20" />

      <Card className="relative rounded-2xl border-border/50 bg-background/70 shadow-lg backdrop-blur supports-[backdrop-filter]:backdrop-blur">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Job Queue</CardTitle>
              <p className="text-xs text-muted-foreground">
                Newest first. Search is fuzzy across model, type, status, and timestamps.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={String(limit)}
                onValueChange={(v) => setLimit(Number(v))}
                disabled={loading}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Limit" />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n} rows</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                placeholder="Fuzzy search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-[240px]"
              />

              <Button
                variant="outline"
                size="sm"
                onClick={() => load()}
                disabled={loading}
                className="inline-flex items-center gap-2"
                title="Refresh"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : loading && !payload ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-md border bg-background/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Model ID</TableHead>
                    <TableHead className="min-w-[160px]">Job Type</TableHead>
                    <TableHead className="min-w-[110px]">Status</TableHead>
                    <TableHead className="min-w-[180px]">Created</TableHead>
                    <TableHead className="min-w-[280px]">Last Error</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                        No jobs found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((j, idx) => (
                      <TableRow key={`${j.model_id ?? "no-model"}-${j.job_type}-${j.created_at}-${idx}`}>
                        <TableCell className="font-medium">
                          {j.model_id ?? "—"}
                        </TableCell>
                        <TableCell>{j.job_type}</TableCell>
                        <TableCell>
                          <StatusBadge status={j.status} />
                        </TableCell>
                        <TableCell>{fmt(j.created_at)}</TableCell>
                        <TableCell className="max-w-[420px] truncate" title={j.last_error ?? ""}>
                          {j.last_error ?? "—"}
                        </TableCell>
                        
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
