export type AIProvider = "openai" | "openrouter" | "kimi";

const DEFAULT_PROVIDER: AIProvider = "kimi";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.4";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";

function readEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function normalizeProvider(value?: string): AIProvider {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "openai" ||
    normalized === "openrouter" ||
    normalized === "kimi"
  ) {
    return normalized;
  }

  return DEFAULT_PROVIDER;
}

export function getProvider(overrideProvider?: string): AIProvider {
  return normalizeProvider(overrideProvider ?? readEnvValue("AI_PROVIDER"));
}

export function getProviderLabel(provider: AIProvider): string {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "kimi") return "Kimi";
  return "OpenAI";
}

export function supportsExactInputTokenCount(provider: AIProvider): boolean {
  return provider === "openai";
}

export function shouldUseExactInputTokenCount(params: {
  provider: AIProvider;
  apiKey?: string;
}): boolean {
  return supportsExactInputTokenCount(params.provider) && Boolean(params.apiKey?.trim());
}

export function getModel(provider = getProvider()): string {
  if (provider === "openrouter") {
    return readEnvValue("OPENROUTER_MODEL") ?? DEFAULT_OPENROUTER_MODEL;
  }

  if (provider === "kimi") {
    return (
      readEnvValue("KIMI_MODEL") ??
      readEnvValue("MOONSHOT_MODEL") ??
      DEFAULT_KIMI_MODEL
    );
  }

  return readEnvValue("OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
}
