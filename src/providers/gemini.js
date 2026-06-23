import { Provider } from './provider.js';

export class GeminiClient extends Provider {
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

    const modelName = this.model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

    // Format system prompt + chat history for Gemini
    const contents = [
      {
        role: 'user',
        parts: [{ text: `System Instruction: ${systemPrompt}` }]
      },
      ...chatHistory.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: contents,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error(`Gemini invocation failed: ${error.message}`);
    }
  }
}
