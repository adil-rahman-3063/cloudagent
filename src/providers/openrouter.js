import { Provider } from './provider.js';

export class OpenRouterClient extends Provider {
  async generateToolCall(chatHistory, tools) {
    const systemPrompt = `You are CloudAgent, a helpful, local-first AI assistant for Google Workspace and local systems.
You translate natural language requests into structured tool calls.
You MUST respond ONLY with a raw JSON object (no markdown code blocks, no backticks, no trailing characters) matching one of the following schemas:

If you need to execute a tool:
{
  "thought": "Brief reasoning explaining your next step",
  "tool": "tool_name",
  "arguments": { ... }
}

If no tool execution is required or you are replying directly to the user:
{
  "thought": "Brief reasoning explaining your reply",
  "text": "Your direct message response here"
}

Available Tools:
${JSON.stringify(tools, null, 2)}

Resolve references to folders, files, or previous contexts using the session history.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role, content: m.content }))
    ];

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/googleworkspace/cli', // Recommended by OpenRouter
          'X-Title': 'CloudAgent'
        },
        body: JSON.stringify({
          model: this.model || 'moonshotai/kimi-k2',
          messages: messages,
          temperature: 0.1,
          response_format: { type: 'json_object' } // Request strict JSON format
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content?.trim() || '{}';
      
      // Clean up markdown code block notation if LLM ignored instructions
      let cleanedJson = rawText;
      if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      }

      const parsed = JSON.parse(cleanedJson);
      return parsed;
    } catch (error) {
      throw new Error(`OpenRouter invocation failed: ${error.message}`);
    }
  }
}
