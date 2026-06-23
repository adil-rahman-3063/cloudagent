import { readConfig } from './config.js';
import { OpenRouterClient } from './providers/openrouter.js';
import { OpenAIClient } from './providers/openai.js';
import { GeminiClient } from './providers/gemini.js';
import { AnthropicClient } from './providers/anthropic.js';
import { PROVIDERS } from './providers/models.js';

export function getActiveProvider() {
  const config = readConfig();
  const providerName = config.active_provider || 'openrouter';
  const providerMeta = PROVIDERS[providerName];
  const apiKey = config.providers?.[providerName]?.api_key || '';
  const model = config.active_model || providerMeta.defaultModel;

  if (!apiKey) {
    throw new Error(`No API key configured for provider "${providerName}". Please configure it using config tools.`);
  }

  switch (providerName) {
    case 'openrouter':
      return new OpenRouterClient(apiKey, model);
    case 'openai':
      return new OpenAIClient(apiKey, model);
    case 'gemini':
      return new GeminiClient(apiKey, model);
    case 'anthropic':
      return new AnthropicClient(apiKey, model);
    default:
      throw new Error(`Unsupported provider: ${providerName}`);
  }
}

export async function askAgent(chatHistory, tools) {
  const provider = getActiveProvider();
  return await provider.generateToolCall(chatHistory, tools);
}
