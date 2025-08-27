// Core model types for SpectraGram (voice-model inventory + benchmarking)

export type STTFeatureFlags = {
  streaming?: boolean;
  diarization?: boolean;
  punctuation?: boolean;
  profanityFilter?: boolean;
  timestamps?: boolean | "word" | "char" | "phrase";
  translation?: boolean;
};

export type STTPricing = {
  perMinuteUsd?: number;
  perSecondUsd?: number;
  notes?: string;
};

export type STTEval = {
  wer?: number;   // Word Error Rate (0..1 or 0..100 depending on convention)
  cer?: number;   // Character Error Rate
  dataset?: string;
};

export type STTLimits = {
  maxAudioMinutes?: number;
};

/* ----------------------------- Access & Repo ----------------------------- */

export type RepositoryProvider = "github" | "gitlab" | "huggingface" | "other";

export type RepositoryInfo = {
  visibility?: "public" | "private";
  provider?: RepositoryProvider;
  url?: string;     // repo or model card URL
  token?: string;   // required if visibility = private (client shows; store server-side)
};

export type Access = {
  /** Publicly reachable HTTP endpoint (leave empty for self-hosted-only/private repos) */
  baseUrl?: string;
  /** API key for public endpoint (stored securely server-side) */
  apiKey?: string;
  repository?: RepositoryInfo;
};

/* ----------------------------- Eval Plan (to run) ----------------------------- */

export type AccuracyEvalPlan = {
  enabled?: boolean;
  metrics?: {
    wer?: boolean;
    cer?: boolean;
    wa?: boolean; // Word Accuracy
  };
};

export type PerformanceEvalPlan = {
  enabled?: boolean;
  metrics?: {
    wpm?: boolean;                 // words per minute
    rtf?: boolean;                 // real-time factor
    latency?: boolean;             // overall e2e latency
    firstResponseLatency?: boolean; // time to first token/response
  };
};

export type EvalPlan = {
  datasets?: string[];               // which test sets to run against
  accuracy?: AccuracyEvalPlan;
  performance?: PerformanceEvalPlan;
};

/* ------------------------------- HTTP Templates ------------------------------- */

export type HTTPRequestTemplate = {
  headers?: Record<string, string>;
  body?: unknown;
};

/* -------------------------------- STT Model -------------------------------- */

export type STTModel = {
  /** Auto-generated inventory id (provider_name_modelid_version). Not editable on UI. */
  id?: string;

  task?: "stt";               // reserved for multi-task future
  name: string;               // “Nova STT”
  provider: string;           // “Deepgram”, “OpenAI”, etc.
  model: string;              // provider model id, e.g., “nova-2”
  version?: string;

  // (legacy root) Deprecated on root; prefer `access.*`
  baseUrl?: string;
  apiKey?: string;

  access?: Access;

  languages?: string[];       // e.g., ["en", "es"]
  tags?: string[];            // arbitrary labels

  features?: STTFeatureFlags;
  latencyMs?: number;

  price?: STTPricing;

  // Latest/representative evaluation results (values)
  eval?: STTEval;

  // What to run during evaluation (selection)
  evalPlan?: EvalPlan;

  // Optional HTTP request template for public endpoints (headers & body)
  requestTemplate?: HTTPRequestTemplate;

  limits?: STTLimits;

  notes?: string;
};

export const defaultSTTModel: STTModel = {
  id: "",
  task: "stt",
  name: "",
  provider: "",
  model: "",
  version: "",
  // root deprecated, use access.*
  baseUrl: "",
  apiKey: "",
  access: {
    baseUrl: "",
    apiKey: "",
    repository: {
      visibility: "public",
      provider: "github",
      url: "",
      token: "",
    },
  },
  languages: [],
  tags: [],
  features: {
    streaming: true,
    diarization: false,
    punctuation: true,
    profanityFilter: false,
    timestamps: true,
    translation: false,
  },
  latencyMs: undefined,
  price: { perMinuteUsd: undefined, perSecondUsd: undefined, notes: "" },
  eval: { wer: undefined, cer: undefined, dataset: "" },
  evalPlan: {
    datasets: [],
    accuracy: {
      enabled: true,
      metrics: { wer: true, cer: true, wa: true },
    },
    performance: {
      enabled: true,
      metrics: { wpm: true, rtf: true, latency: true, firstResponseLatency: true },
    },
  },
  requestTemplate: {
    // Defaults mirror Deepgram example; UI shows only when baseUrl/apiKey present
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Token {{apiKey}}",
    },
    body: {
      url: "https://static.deepgram.com/examples/interview_speech-analytics.wav",
    },
  },
  limits: { maxAudioMinutes: undefined },
  notes: "",
};

/* ------------------------------- Utilities --------------------------------- */

/** Normalize comma/newline-separated strings or arrays into string[] */
export function toStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return undefined;
}

/** Best-effort coercion from an arbitrary object into STTModel shape */
export function coerceToSTTModel(obj: any): STTModel {
  const merged: STTModel = {
    ...defaultSTTModel,
    ...obj,

    // Merge access + allow legacy root baseUrl/apiKey
    access: {
      ...defaultSTTModel.access,
      ...(obj?.access ?? {}),
    },

    languages: toStringArray(obj?.languages) ?? defaultSTTModel.languages,
    tags: toStringArray(obj?.tags) ?? defaultSTTModel.tags,

    features: {
      ...defaultSTTModel.features,
      ...(obj?.features ?? {}),
    },

    price: {
      ...defaultSTTModel.price,
      ...(obj?.price ?? {}),
    },

    eval: {
      ...defaultSTTModel.eval,
      ...(obj?.eval ?? {}),
    },

    limits: {
      ...defaultSTTModel.limits,
      ...(obj?.limits ?? {}),
    },

    evalPlan: {
      ...defaultSTTModel.evalPlan,
      ...(obj?.evalPlan ?? {}),
    },

    requestTemplate: {
      ...defaultSTTModel.requestTemplate,
      ...(obj?.requestTemplate ?? {}),
    },
  };

  // Map legacy fields into access.*
  if (obj?.baseUrl && !merged.access?.baseUrl) merged.access!.baseUrl = obj.baseUrl;
  if (obj?.apiKey && !merged.access?.apiKey) merged.access!.apiKey = obj.apiKey;

  // Coerce arrays from strings
  const datasetsFromPlan = toStringArray(obj?.evalPlan?.datasets);
  if (datasetsFromPlan) merged.evalPlan!.datasets = datasetsFromPlan;

  // Numeric coercions if user supplied strings
  if (typeof merged.latencyMs === "string") merged.latencyMs = Number(merged.latencyMs) || undefined;
  if (merged.price?.perMinuteUsd && typeof merged.price.perMinuteUsd === "string") {
    merged.price.perMinuteUsd = Number(merged.price.perMinuteUsd) || undefined;
  }
  if (merged.price?.perSecondUsd && typeof merged.price.perSecondUsd === "string") {
    merged.price.perSecondUsd = Number(merged.price.perSecondUsd) || undefined;
  }
  if (merged.eval?.wer && typeof merged.eval.wer === "string") {
    merged.eval.wer = Number(merged.eval.wer) || undefined;
  }
  if (merged.eval?.cer && typeof merged.eval.cer === "string") {
    merged.eval.cer = Number(merged.eval.cer) || undefined;
  }
  if (merged.limits?.maxAudioMinutes && typeof merged.limits.maxAudioMinutes === "string") {
    merged.limits.maxAudioMinutes = Number(merged.limits.maxAudioMinutes) || undefined;
  }

  return merged;
}

/** Minimal client-side validation */
export function validateSTTModel(m: STTModel): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!m.name?.trim()) errors.push("Name is required.");
  if (!m.provider?.trim()) errors.push("Provider is required.");
  if (!m.model?.trim()) errors.push("Model ID is required.");
  return { ok: errors.length === 0, errors };
}
