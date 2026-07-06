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

export async function fetchAndValidateProviderModels(provider, apiKey) {
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      let errorMsg = text;
      try {
        const parsed = JSON.parse(text);
        errorMsg = parsed.error?.message || text;
      } catch (e) {}
      throw new Error(`Gemini API Error: ${errorMsg}`);
    }
    const data = await res.json();
    if (!data.models) {
      throw new Error('Invalid Gemini API response: No models found.');
    }
    
    // Pricing per 1M tokens in USD
    const GEMINI_PRICING = {
      'gemini-2.0-flash-lite': { input: 0.0375, output: 0.15 },
      'gemini-2.0-flash-lite-preview-02-05': { input: 0.0375, output: 0.15 },
      'gemini-2.0-flash': { input: 0.075, output: 0.30 },
      'gemini-2.0-flash-exp': { input: 0, output: 0 },
      'gemini-2.0-flash-thinking-exp-01-21': { input: 0, output: 0 },
      'gemini-2.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
      'gemini-2.0-pro-exp': { input: 1.25, output: 5.00 },
      'gemini-2.5-pro': { input: 1.25, output: 5.00 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 }
    };

    const models = data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => {
        const id = m.name.replace('models/', '');
        const pricing = GEMINI_PRICING[id] || { input: 0, output: 0, unknown: true };
        return {
          id,
          name: m.displayName || id,
          inputCost: pricing.input,
          outputCost: pricing.output,
          unknown: pricing.unknown
        };
      });

    // Sort: cheaper to expensive. Unknown/experimental goes to the bottom.
    models.sort((a, b) => {
      if (a.unknown && !b.unknown) return 1;
      if (!a.unknown && b.unknown) return -1;
      if (a.unknown && b.unknown) return a.id.localeCompare(b.id);
      
      const priceA = a.inputCost + a.outputCost;
      const priceB = b.inputCost + b.outputCost;
      return priceA - priceB;
    });

    return models;
  }
  
  if (provider === 'openai') {
    const url = 'https://api.openai.com/v1/models';
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    if (!res.ok) {
      const text = await res.text();
      let errorMsg = text;
      try {
        const parsed = JSON.parse(text);
        errorMsg = parsed.error?.message || text;
      } catch (e) {}
      throw new Error(`OpenAI API Error: ${errorMsg}`);
    }
    const data = await res.json();
    if (!data.data) {
      throw new Error('Invalid OpenAI API response: No models found.');
    }

    // Pricing per 1M tokens in USD
    const OPENAI_PRICING = {
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4o-mini-2024-07-18': { input: 0.15, output: 0.60 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
      'gpt-3.5-turbo-0125': { input: 0.50, output: 1.50 },
      'o3-mini': { input: 1.10, output: 4.40 },
      'o3-mini-2025-01-31': { input: 1.10, output: 4.40 },
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4o-2024-08-06': { input: 2.50, output: 10.00 },
      'gpt-4o-2024-05-13': { input: 5.00, output: 15.00 },
      'gpt-4-turbo': { input: 10.00, output: 30.00 },
      'gpt-4-turbo-2024-04-09': { input: 10.00, output: 30.00 },
      'gpt-4': { input: 30.00, output: 60.00 },
      'o1-mini': { input: 3.00, output: 12.00 },
      'o1-mini-2024-09-12': { input: 3.00, output: 12.00 },
      'o1-preview': { input: 15.00, output: 60.00 },
      'o1': { input: 15.00, output: 60.00 }
    };

    const models = data.data
      .filter(m => m.id.startsWith('gpt-') || m.id.startsWith('o1-') || m.id === 'o1' || m.id.startsWith('o3-'))
      .map(m => {
        const pricing = OPENAI_PRICING[m.id] || { input: 0, output: 0, unknown: true };
        return {
          id: m.id,
          name: m.id,
          inputCost: pricing.input,
          outputCost: pricing.output,
          unknown: pricing.unknown
        };
      });

    models.sort((a, b) => {
      if (a.unknown && !b.unknown) return 1;
      if (!a.unknown && b.unknown) return -1;
      if (a.unknown && b.unknown) return a.id.localeCompare(b.id);
      
      const priceA = a.inputCost + a.outputCost;
      const priceB = b.inputCost + b.outputCost;
      return priceA - priceB;
    });

    return models;
  }

  return [];
}

