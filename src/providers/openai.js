import { Provider } from './provider.js';

export class OpenAIClient extends Provider {
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

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role, content: m.content }))
    ];

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model || 'gpt-4o-mini',
          messages: messages,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content?.trim() || '{}';
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`OpenAI invocation failed: ${error.message}`);
    }
  }
}
