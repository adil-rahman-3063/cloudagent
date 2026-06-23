import { Provider } from './provider.js';

export class AnthropicClient extends Provider {
  async generateToolCall(chatHistory, tools) {
    const systemPrompt = `You are CloudAgent, a local-first AI assistant for Google Workspace and local systems.
You MUST respond ONLY with a raw JSON object:
If invoking a tool:
{
  "thought": "Reasoning",
  "tool": "tool_name",
  "arguments": { ... }
}
If replying:
{
  "thought": "Reasoning",
  "text": "Your message"
}

Available Tools:
${JSON.stringify(tools, null, 2)}`;

    const messages = chatHistory.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model || 'claude-3-5-sonnet-20241022',
          system: systemPrompt,
          messages: messages,
          max_tokens: 4096,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const rawText = data.content?.[0]?.text?.trim() || '{}';
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`Anthropic invocation failed: ${error.message}`);
    }
  }
}
