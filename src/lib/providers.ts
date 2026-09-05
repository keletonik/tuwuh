/**
 * Provider catalogue shown in Settings.
 *
 * Each vendor has its own default model. Switching the active provider must
 * not keep the previous vendor's model id, which would 404. The list is the
 * starting set in the dropdown; a custom id is always allowed.
 */
import type { ProviderId } from "./api";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  blurb: string;
  needsKey: boolean;
  keyHint: string;
  defaultModel: string;
  models: string[];
  defaultBaseUrl: string | null;
  baseUrlHint?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Claude, Messages API.",
    needsKey: true,
    keyHint: "sk-ant-…",
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-opus-4.1", "claude-haiku-4.5"],
    defaultBaseUrl: null,
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT models, Chat Completions.",
    needsKey: true,
    keyHint: "sk-…",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini", "o4-mini"],
    defaultBaseUrl: null,
  },
  {
    id: "xai",
    label: "xAI",
    blurb: "Grok, OpenAI-compatible.",
    needsKey: true,
    keyHint: "xai-…",
    defaultModel: "grok-4",
    models: ["grok-4", "grok-4-fast"],
    defaultBaseUrl: null,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "One key, many vendors.",
    needsKey: true,
    keyHint: "sk-or-…",
    defaultModel: "anthropic/claude-sonnet-5",
    models: [
      "anthropic/claude-sonnet-5",
      "openai/gpt-5",
      "x-ai/grok-4",
      "qwen/qwen-2.5-7b-instruct",
    ],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    baseUrlHint: "Leave blank for the OpenRouter default.",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    blurb: "Inference Providers router. Token from huggingface.co/settings/tokens.",
    needsKey: true,
    keyHint: "hf_…",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct:fastest",
    models: [
      "Qwen/Qwen2.5-7B-Instruct:fastest",
      "meta-llama/Llama-3.1-8B-Instruct:fastest",
      "openai/gpt-oss-20b:fastest",
    ],
    defaultBaseUrl: "https://router.huggingface.co/v1",
    baseUrlHint: "Default is the Hugging Face router. Override only if you host your own.",
  },
  {
    id: "ollama",
    label: "Local (Ollama)",
    blurb: "Models on this machine. No key. Point the base URL at any OpenAI-compatible local server.",
    needsKey: false,
    keyHint: "",
    defaultModel: "llama3.2",
    models: ["llama3.2", "qwen2.5", "mistral", "codellama", "deepseek-r1"],
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlHint: "Ollama default is http://localhost:11434/v1. llama.cpp --server uses :8080/v1.",
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function modelFor(id: ProviderId, models: Record<string, string> | undefined): string {
  const stored = models?.[id]?.trim();
  return stored || providerInfo(id).defaultModel;
}
