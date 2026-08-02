import { createAnthropicClient } from "@nseluga/app-core";
import { getConfig, type AppConfig } from "./env";

type AnthropicClient = ReturnType<typeof createAnthropicClient>;

export interface AiDeps {
  createClient?: typeof createAnthropicClient;
  config?: AppConfig;
}

export function maybeGetAiClient(deps: AiDeps = {}): AnthropicClient | null {
  const config = deps.config ?? getConfig();
  if (!config.aiEnabled || !config.anthropicApiKey) return null;
  const createClient = deps.createClient ?? createAnthropicClient;
  return createClient({ apiKey: config.anthropicApiKey });
}

export function isAiEnabled(deps: AiDeps = {}): boolean {
  const config = deps.config ?? getConfig();
  return config.aiEnabled;
}
