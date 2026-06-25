import { readModels } from '../config.js';

export const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    get defaultModel() {
      const list = readModels();
      return list[0] || 'openai/gpt-oss-120b:free';
    },
    endpoint: 'https://openrouter.ai/api/v1/chat/completions'
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-1.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  },
  anthropic: {
    name: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.anthropic.com/v1/messages'
  }
};
