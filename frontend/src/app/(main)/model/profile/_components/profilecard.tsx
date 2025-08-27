"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/* ---------- Types for the NEW schema ---------- */
type DevStage = "research" | "alpha" | "beta" | "production";
type ModelStatus = "active" | "maintenance" | "deprecated";
type RepositoryProvider = "pypi" | "github" | "gitlab" | "huggingface" | "other";
type Visibility = "public" | "private";

export interface ModelDetail {
  id: string;
  basicInformation: {
    type: string;
    provider: string;
    modelName: string;
    modelVersion: string;
    developmentStage: DevStage;
    status: ModelStatus;
    supportedLanguage: string[];
    tags: string[];
  };
  modelCard: {
    detail: string;
  };
  access: {
    baseUrl: string;
    apiKey: string;
    requestQuota: string;
    repository: {
      repositoryProvider: RepositoryProvider;
      visibility: Visibility;
      repoName: string;
      repoAccessToken: string;
    };
  };
  evalPlan?: {
    evalVersion: string;
    datasets: string[];
  };
}

/* Fetch detail from your API */
async function fetchModelDetail(id: string, signal?: AbortSignal): Promise<ModelDetail> {
  const url = `/api/model_detail?id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "GET", signal });
  if (!res.ok) throw new Error(`model_detail failed: ${res.status}`);
  return res.json();
}

export default function ModelProfileCard({ selectedId }: { selectedId: string | null }) {
  const [data, setData] = React.useState<ModelDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const detail = await fetchModelDetail(selectedId, controller.signal);
        setData(detail);
      } catch (e: any) {
        setError(e?.message || "Failed to load model detail");
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedId]);

  if (!selectedId) {
    return <div className="text-sm text-muted-foreground">Select a model to view details.</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>;
  }

  if (!data) return null;

  return <TwoCardProfile data={data} />;
}

/* ---------------------------- Presentational ---------------------------- */

function TwoCardProfile({ data }: { data: ModelDetail }) {
  const bi = data.basicInformation ?? {
    type: "",
    provider: "",
    modelName: "",
    modelVersion: "",
    developmentStage: "research",
    status: "active",
    supportedLanguage: [],
    tags: [],
  };
  const access = data.access ?? {
    baseUrl: "",
    apiKey: "",
    requestQuota: "",
    repository: {
      repositoryProvider: "pypi",
      visibility: "public",
      repoName: "",
      repoAccessToken: "",
    },
  };
  const repo = access.repository ?? {
    repositoryProvider: "pypi",
    visibility: "public",
    repoName: "",
    repoAccessToken: "",
  };

  const languages = bi.supportedLanguage ?? [];
  const tags = bi.tags ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* LEFT: Model Summary */}
      <Card className="from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Model Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {data.modelCard?.detail ? (
            <p className="whitespace-pre-wrap text-sm text-foreground/80">
              {data.modelCard.detail}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No summary provided.</p>
          )}
        </CardContent>
      </Card>

      {/* RIGHT: Model Details */}
      <Card className="from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Model Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Basic Information */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground">Basic Information</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <InlineField label="Type" value={bi.type} />
              <InlineField label="Provider" value={bi.provider} />
              <InlineField label="Model Name" value={bi.modelName} />
              <InlineField label="Model Version" value={bi.modelVersion} />
              <InlineField label="Development Stage" value={bi.developmentStage} />
              <InlineField label="Status" value={bi.status} />
            </div>

            {(languages.length > 0 || tags.length > 0) && (
              <>
                <Separator className="my-2" />
                <div className="grid gap-4 sm:grid-cols-2">
                  {languages.length > 0 && (
                    <div className="space-y-1">
                      <Label>Supported Languages</Label>
                      <div className="flex flex-wrap gap-2">
                        {languages.map((l) => (
                          <Badge key={l} variant="secondary">
                            {l}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {tags.length > 0 && (
                    <div className="space-y-1">
                      <Label>Tags</Label>
                      <div className="flex flex-wrap gap-2">
                        {tags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          <Separator />

          {/* Access */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground">Access</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <InlineField label="Base URL" value={access.baseUrl || "—"} />
              <InlineField label="API Key" value={access.apiKey ? "********" : "—"} />
              <InlineField label="Request Quota" value={access.requestQuota || "—"} />
              <InlineField label="Repo Provider" value={repo.repositoryProvider || "—"} />
              <InlineField label="Repo Visibility" value={repo.visibility || "—"} />
              <InlineField label="Repo Name" value={repo.repoName || "—"} />
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function InlineField({ label, value }: { label: string; value: any }) {
  const display = value != null && String(value).trim() !== "" ? String(value) : "—";
  return (
    <div className="text-sm text-foreground/80">
      <span className="font-semibold">{label}:</span> {display}
    </div>
  );
}
