// src/app/(main)/model/onboard/_components/onboard.tsx
"use client";

import * as React from "react";
import YAML from "js-yaml";

/* shadcn / UI */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

/* Icons */
import {
  Loader2,
  Check,
  AlertCircle,
  ChevronsUpDown,
  Shield,
  Database,
} from "lucide-react";

/* ----------------------------- types ----------------------------- */

type RepositoryProvider = "pypi" | "github" | "gitlab" | "huggingface" | "other";
type Visibility = "public" | "private";
type DevStage = "research" | "alpha" | "beta" | "production";
type ModelStatus = "active" | "maintenance" | "deprecated";

export interface NewModelPayload {
  id: string; // inventory id (auto for new; locked when editing)
  basicInformation: {
    type: string; // e.g. "stt"
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
    requestQuota: string; // maps to worker max_per_subset (optional)
    repository: {
      repositoryProvider: RepositoryProvider; // default: pypi
      visibility: Visibility;
      repoName: string;        // e.g. "openai/whisper" or PyPI package name
      repoAccessToken: string; // if visibility=private
    };
  };
  evalPlan: {
    evalVersion: string; // e.g. "v1"
    datasets: string[];  // ["librispeech"]
  };
}

/* ----------------------- defaults & helpers ----------------------- */

const defaultPayload: NewModelPayload = {
  id: "",
  basicInformation: {
    type: "stt",
    provider: "",
    modelName: "",
    modelVersion: "",
    developmentStage: "research",
    status: "active",
    supportedLanguage: [],
    tags: [],
  },
  modelCard: {
    detail: "",
  },
  access: {
    baseUrl: "",
    apiKey: "",
    requestQuota: "",
    repository: {
      repositoryProvider: "pypi",
      visibility: "public",
      repoName: "",
      repoAccessToken: "",
    },
  },
  evalPlan: {
    evalVersion: "v1",
    datasets: [],
  },
};

function safeIdPart(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function computeInventoryId(m: NewModelPayload) {
  const bi = m.basicInformation;
  return [bi.type, bi.provider, bi.modelName, bi.modelVersion]
    .map(safeIdPart)
    .filter(Boolean)
    .join("_");
}

function isDevStage(x: any): x is DevStage {
  return ["research", "alpha", "beta", "production"].includes(x);
}
function isModelStatus(x: any): x is ModelStatus {
  return ["active", "maintenance", "deprecated"].includes(x);
}

function coerce(obj: any): NewModelPayload {
  const stage = obj?.basicInformation?.developmentStage;
  const status = obj?.basicInformation?.status;
  const out: NewModelPayload = {
    id: String(obj?.id ?? ""),
    basicInformation: {
      type: obj?.basicInformation?.type ?? "stt",
      provider: obj?.basicInformation?.provider ?? "",
      modelName: obj?.basicInformation?.modelName ?? "",
      modelVersion: obj?.basicInformation?.modelVersion ?? "",
      developmentStage: isDevStage(stage) ? stage : "research",
      status: isModelStatus(status) ? status : "active",
      supportedLanguage: Array.isArray(obj?.basicInformation?.supportedLanguage)
        ? obj.basicInformation.supportedLanguage.map(String)
        : [],
      tags: Array.isArray(obj?.basicInformation?.tags)
        ? obj.basicInformation.tags.map(String)
        : [],
    },
    modelCard: {
      detail: obj?.modelCard?.detail ?? "",
    },
    access: {
      baseUrl: obj?.access?.baseUrl ?? "",
      apiKey: obj?.access?.apiKey ?? "",
      requestQuota: obj?.access?.requestQuota ?? "",
      repository: {
        repositoryProvider:
          (obj?.access?.repository?.repositoryProvider as RepositoryProvider) ?? "pypi",
        visibility: (obj?.access?.repository?.visibility as Visibility) ?? "public",
        repoName: obj?.access?.repository?.repoName ?? "",
        repoAccessToken: obj?.access?.repository?.repoAccessToken ?? "",
      },
    },
    evalPlan: {
      evalVersion: obj?.evalPlan?.evalVersion ?? "v1",
      datasets: Array.isArray(obj?.evalPlan?.datasets)
        ? obj.evalPlan.datasets.map(String)
        : [],
    },
  };
  // If no id set, compute from form; otherwise keep server-provided id.
  out.id = out.id || computeInventoryId(out);
  return out;
}

function validate(m: NewModelPayload): { ok: boolean; errors: string[] } {
  const errs: string[] = [];
  if (!m.basicInformation.provider) errs.push("Provider is required.");
  if (!m.basicInformation.modelName) errs.push("Model name is required.");
  if (!m.evalPlan.evalVersion) errs.push("Evaluation version is required.");
  return { ok: errs.length === 0, errors: errs };
}

const parseList = (s: string): string[] =>
  (s || "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ----------------------------- data fetchers ----------------------------- */

async function fetchModelList(signal?: AbortSignal): Promise<string[]> {
  const res = await fetch("/api/model_list", { signal });
  if (!res.ok) throw new Error(`model_list failed: ${res.status}`);
  const data = await res.json();
  // Accept either ["id1","id2"] or [{id:"id1"}, ...]
  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === "string") return data as string[];
    return (data as any[]).map((x) => (typeof x === "string" ? x : String(x?.id ?? ""))).filter(Boolean);
  }
  // Accept { ids: [...] }
  if (Array.isArray((data as any).ids)) {
    return (data as any).ids.map(String);
  }
  return [];
}

async function fetchModelDetail(id: string, signal?: AbortSignal): Promise<NewModelPayload> {
  const res = await fetch(`/api/model_detail?id=${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw new Error(`model_detail failed: ${res.status}`);
  const obj = await res.json();
  return coerce(obj);
}

/* ----------------------------- component ----------------------------- */

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success"; id?: string }
  | { status: "error"; message: string };

export default function OnBoardModel() {
  // Inventory select state
  const [inventoryIds, setInventoryIds] = React.useState<string[]>([]);
  const [selectedInventoryId, setSelectedInventoryId] = React.useState<string>("__none__");
  const [loadingSelection, setLoadingSelection] = React.useState(false);
  const [loadErr, setLoadErr] = React.useState<string | null>(null);

  // YAML editor + form state
  const [yamlText, setYamlText] = React.useState<string>(() => YAML.dump(defaultPayload));
  const [form, setForm] = React.useState<NewModelPayload>(defaultPayload);
  const [yamlError, setYamlError] = React.useState<string | null>(null);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });

  // When editing an existing model, keep its server ID locked (don’t auto-recompute).
  const [lockedId, setLockedId] = React.useState<string | null>(null);

  // Debounce + guard for auto-sync
  const yamlDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatingFromYamlRef = React.useRef(false);

  // Datasets multi-select only
  const [datasetOpen, setDatasetOpen] = React.useState(false);
  const [availableDatasets] = React.useState<string[]>([
    "librispeech",
    "cv-corpus-22",
    "meeting-farfield-v2",
    "telephony-10dB",
  ]);

  // Free typing for languages/tags, parse on blur
  const [languagesText, setLanguagesText] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");

  // Load inventory IDs on mount
  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const ids = await fetchModelList(controller.signal);
        setInventoryIds(ids);
      } catch (e: any) {
        // non-fatal
      }
    })();
    return () => controller.abort();
  }, []);

  // Handle inventory selection changes
  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoadErr(null);
      setLoadingSelection(true);
      try {
        if (!selectedInventoryId || selectedInventoryId === "__none__") {
          // Create new: reset to defaults
          setLockedId(null);
          const fresh = structuredClone(defaultPayload);
          setForm(fresh);
          setYamlText(YAML.dump(fresh));
        } else {
          // Edit existing: fetch and load
          const detail = await fetchModelDetail(selectedInventoryId, controller.signal);
          setLockedId(detail.id || selectedInventoryId);
          setForm(detail);
          setYamlText(YAML.dump(detail));
        }
      } catch (e: any) {
        setLoadErr(e?.message ?? "Failed to load model.");
      } finally {
        setLoadingSelection(false);
      }
    })();
    return () => controller.abort();
  }, [selectedInventoryId]);

  // AUTO: YAML → Form (debounced)
  React.useEffect(() => {
    if (yamlDebounceRef.current) clearTimeout(yamlDebounceRef.current);
    yamlDebounceRef.current = setTimeout(() => {
      try {
        const obj = YAML.load(yamlText) ?? {};
        const normalized = coerce(obj);
        // If we’re editing an existing model, keep its id locked
        if (lockedId) normalized.id = lockedId;
        updatingFromYamlRef.current = true;
        setForm(normalized);
        setYamlError(null);
      } catch (e: any) {
        setYamlError(e?.message ?? "Failed to parse YAML.");
      }
    }, 400);
    return () => {
      if (yamlDebounceRef.current) clearTimeout(yamlDebounceRef.current);
    };
  }, [yamlText, lockedId]);

  // AUTO: Form → YAML (unless triggered by YAML parse)
  React.useEffect(() => {
    // Auto-generate ID only when not editing an existing record
    if (!lockedId) {
      const id = computeInventoryId(form);
      if (form.id !== id) {
        setForm((f) => ({ ...f, id }));
      }
    } else if (form.id !== lockedId) {
      // Ensure we keep the locked server id
      setForm((f) => ({ ...f, id: lockedId }));
    }

    if (updatingFromYamlRef.current) {
      updatingFromYamlRef.current = false;
      return;
    }
    setYamlText(YAML.dump(form));
  }, [
    form.basicInformation.type,
    form.basicInformation.provider,
    form.basicInformation.modelName,
    form.basicInformation.modelVersion,
    form.basicInformation.developmentStage,
    form.basicInformation.status,
    form.basicInformation.supportedLanguage,
    form.basicInformation.tags,
    form.access.baseUrl,
    form.access.apiKey,
    form.access.requestQuota,
    form.access.repository.repositoryProvider,
    form.access.repository.visibility,
    form.access.repository.repoName,
    form.access.repository.repoAccessToken,
    form.evalPlan.evalVersion,
    form.evalPlan.datasets,
    lockedId,
  ]);

  // Keep languages/tags text in sync when form changes (e.g., after YAML parse or selection)
  React.useEffect(() => {
    setLanguagesText((form.basicInformation.supportedLanguage ?? []).join(", "));
  }, [form.basicInformation.supportedLanguage]);
  React.useEffect(() => {
    setTagsText((form.basicInformation.tags ?? []).join(", "));
  }, [form.basicInformation.tags]);

  // Helpers to update nested fields
  const updateNested = (path: string[], value: any) => {
    setForm((f) => {
      const clone: any = structuredClone(f);
      let cur: any = clone;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        cur[k] = cur[k] ?? {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = value;
      return clone;
    });
  };

  // Shorthands
  const setBI = (
    field: keyof NewModelPayload["basicInformation"],
    v: any
  ) => updateNested(["basicInformation", field], v);
  const setMC = (v: string) => updateNested(["modelCard", "detail"], v);
  const setAccess = (field: keyof NewModelPayload["access"], v: any) =>
    updateNested(["access", field], v);
  const setRepo = (
    field: keyof NewModelPayload["access"]["repository"],
    v: any
  ) => updateNested(["access", "repository", field], v);
  const setEvalPlan = (field: keyof NewModelPayload["evalPlan"], v: any) =>
    updateNested(["evalPlan", field], v);

  const selectedDatasets = form.evalPlan.datasets ?? [];
  const toggleDataset = (ds: string) => {
    const next = new Set(selectedDatasets);
    if (next.has(ds)) next.delete(ds);
    else next.add(ds);
    setEvalPlan("datasets", Array.from(next));
  };

  const canSubmit = React.useMemo(() => validate(form).ok, [form]);

  async function submit() {
    const v = validate(form);
    if (!v.ok) {
      setSave({ status: "error", message: v.errors.join(" ") });
      return;
    }
    setSave({ status: "saving" });
    try {
      const res = await fetch("/api/model_onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed with ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      setSave({ status: "success", id: data?.id });
      // refresh list (in case new id was created)
      try {
        const ids = await fetchModelList();
        setInventoryIds(ids);
        // lock id if we just created a new one and stayed in "create" mode
        if (!lockedId) setLockedId(data?.id ?? form.id);
      } catch {}
    } catch (e: any) {
      setSave({ status: "error", message: e?.message ?? "Failed to save." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Inventory selector */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" />
            Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label className="text-foreground/80">Inventory ID</Label>
            <Select
              value={selectedInventoryId}
              onValueChange={setSelectedInventoryId}
              disabled={loadingSelection}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an Inventory ID" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (Create new)</SelectItem>
                {inventoryIds.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadErr && (
              <p className="text-xs text-destructive mt-1">Load error: {loadErr}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-foreground/80">Current ID</Label>
            <Input value={form.id} readOnly />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2">
        {/* LEFT: YAML + JSON preview (auto-sync) */}
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-lg">YAML (auto-sync)</CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-3">
            <Textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              placeholder="# Edit YAML here — it auto-updates the form"
              className="min-h-[280px] font-mono text-sm"
            />
            {yamlError && (
              <Alert variant="destructive" className="flex items-center">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  YAML error: {yamlError}
                </AlertDescription>
              </Alert>
            )}

            <Separator />

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Preview JSON (auto)</span>
              </div>
              <textarea
                readOnly
                value={JSON.stringify(form, null, 2)}
                className="h-[320px] min-h-[200px] w-full resize-y rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed"
                style={{ tabSize: 2 }}
              />
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: Structured Form (new schema only) */}
        <div className="flex flex-col gap-6">
          {/* Basics */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Model Basics</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Type *">
                <Input
                  value={form.basicInformation.type}
                  onChange={(e) => setBI("type", e.target.value)}
                  placeholder="stt"
                />
              </Field>
              <Field label="Provider *">
                <Input
                  value={form.basicInformation.provider}
                  onChange={(e) => setBI("provider", e.target.value)}
                  placeholder="deepgram / openai / aws / gcp"
                />
              </Field>
              <Field label="Model Name *">
                <Input
                  value={form.basicInformation.modelName}
                  onChange={(e) => setBI("modelName", e.target.value)}
                  placeholder="nova-3 / whisper-1"
                />
              </Field>
              <Field label="Model Version">
                <Input
                  value={form.basicInformation.modelVersion}
                  onChange={(e) => setBI("modelVersion", e.target.value)}
                  placeholder="2025-08"
                />
              </Field>

              {/* Development Stage */}
              <Field label="Development Stage">
                <Select
                  value={form.basicInformation.developmentStage}
                  onValueChange={(v: DevStage) => setBI("developmentStage", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose stage" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="alpha">Alpha</SelectItem>
                    <SelectItem value="beta">Beta</SelectItem>
                    <SelectItem value="production">Production</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Status */}
              <Field label="Status">
                <Select
                  value={form.basicInformation.status}
                  onValueChange={(v: ModelStatus) => setBI("status", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="deprecated">Deprecated</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Free typing; parse to arrays on blur */}
              <Field label="Supported Languages (comma or newline)">
                <Input
                  value={languagesText}
                  onChange={(e) => setLanguagesText(e.target.value)}
                  onBlur={() =>
                    setBI("supportedLanguage", parseList(languagesText))
                  }
                  placeholder="en, es, fr"
                />
              </Field>
              <Field label="Tags (comma or newline)">
                <Input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  onBlur={() => setBI("tags", parseList(tagsText))}
                  placeholder="realtime, low-latency"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Access */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Base URL">
                  <Input
                    value={form.access.baseUrl}
                    onChange={(e) => setAccess("baseUrl", e.target.value)}
                    placeholder="https://api.deepgram.com/v1/listen"
                  />
                </Field>
                <Field label="API Key">
                  <Input
                    type="password"
                    value={form.access.apiKey}
                    onChange={(e) => setAccess("apiKey", e.target.value)}
                    placeholder="(stored server-side)"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Request Quota (max_per_subset)">
                  <Input
                    value={form.access.requestQuota}
                    onChange={(e) => setAccess("requestQuota", e.target.value)}
                    placeholder="e.g., 10"
                  />
                </Field>
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Repository Provider">
                  <Select
                    value={form.access.repository.repositoryProvider}
                    onValueChange={(v: RepositoryProvider) =>
                      setRepo("repositoryProvider", v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pypi">PyPI</SelectItem>
                      <SelectItem value="github">GitHub</SelectItem>
                      <SelectItem value="gitlab">GitLab</SelectItem>
                      <SelectItem value="huggingface">Hugging Face</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Visibility">
                  <Select
                    value={form.access.repository.visibility}
                    onValueChange={(v: Visibility) => setRepo("visibility", v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Visibility" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Repository / Package Name">
                  <Input
                    value={form.access.repository.repoName}
                    onChange={(e) => setRepo("repoName", e.target.value)}
                    placeholder="e.g., openai/whisper or pypi-package"
                  />
                </Field>
                {form.access.repository.visibility === "private" && (
                  <Field label="Repo Access Token">
                    <Input
                      type="password"
                      value={form.access.repository.repoAccessToken}
                      onChange={(e) => setRepo("repoAccessToken", e.target.value)}
                      placeholder="(store server-side)"
                    />
                  </Field>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Evaluation plan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Evaluation Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Evaluation Version">
                  <Input
                    value={form.evalPlan.evalVersion}
                    onChange={(e) => setEvalPlan("evalVersion", e.target.value)}
                    placeholder="v1"
                  />
                </Field>
              </div>

              {/* Multi-select only */}
              <div className="space-y-2">
                <Label>Datasets</Label>
                <Popover open={datasetOpen} onOpenChange={setDatasetOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between">
                      {selectedDatasets.length
                        ? `${selectedDatasets.length} selected`
                        : "Select datasets"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[360px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search datasets..." />
                      <CommandEmpty>No dataset found.</CommandEmpty>
                      <CommandList>
                        <CommandGroup>
                          {availableDatasets.map((ds) => {
                            const checked = selectedDatasets.includes(ds);
                            return (
                              <CommandItem
                                key={ds}
                                value={ds}
                                onSelect={() => toggleDataset(ds)}
                                className="flex cursor-pointer items-center gap-2"
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleDataset(ds)}
                                />
                                <span className="truncate">{ds}</span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {!!selectedDatasets.length && (
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedDatasets.join(", ")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Model Card — below Evaluation Plan */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Model Card</CardTitle>
            </CardHeader>
            <CardContent>
              <Field label="Detail">
                <Textarea
                  value={form.modelCard.detail}
                  onChange={(e) => setMC(e.target.value)}
                  placeholder="Describe the model: training data, limitations, intended use…"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="flex items-center gap-3">
            <Button
              onClick={submit}
              disabled={!canSubmit || save.status === "saving"}
              className="min-w-[128px]"
            >
              {save.status === "saving" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Model"
              )}
            </Button>

            {save.status === "success" && (
              <Alert className="flex items-center">
                <Check className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  Saved{save.id ? ` (id: ${save.id})` : ""}.
                </AlertDescription>
              </Alert>
            )}

            {save.status === "error" && (
              <Alert variant="destructive" className="flex items-center">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="ml-2">
                  Error: {save.message}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- small wrappers ---------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-foreground/80">{label}</Label>
      {children}
    </div>
  );
}
