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
${JSON.stringify(tools, null, 2)}

When the user requests an action (such as sending an email or creating an event) but does not provide all the required arguments (like recipient, subject, body, or time), do NOT try to call the tool with missing or empty parameters. Instead, reply directly to the user asking politely for the missing information (e.g., recipient email, subject, or message body) and offer to help draft the content if needed.

CRITICAL: When presenting retrieved results from listing or searching tools (like emails, calendar events, or files), format the output in a clean, user-friendly, conversational manner using grouped bullet points or natural language descriptions. Do NOT output markdown tables, raw JSON, or box-drawing characters.

CRITICAL: Do NOT generate placeholder text with brackets (such as "[Your Name]" or "[Sender]") in email bodies or drafts. If you need specific details to complete an email (such as the sender's name or other missing info), ask the user to provide or clarify them instead of generating bracketed placeholders, or simply omit the name from the sign-off (e.g., end with "Best regards," or "Thanks!").

CRITICAL: When the user asks you to perform an action (such as sending an email, creating an event, pulling git, writing files), and you have all the required parameters (or can generate them based on the context/draft), you MUST invoke the appropriate tool (e.g. gmail_send) to perform the action. Do NOT reply telling the user you cannot do it or asking them to do it manually, as you have tools specifically for these actions.

CRITICAL: When presenting dates and times to the user, always convert them from UTC (or any timezone returned by tools) to the user's local timezone using the offset specified in the metadata (e.g., +05:30). Display times in user-friendly local formats (e.g. "June 25 at 7:30 PM" or "8:00 PM today").`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role, content: m.content }))
    ];

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

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
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const rawText = data.choices?.[0]?.message?.content?.trim() || '{}';
      return this.robustParseResponse(rawText);
    } catch (error) {
      throw new Error(`OpenAI invocation failed: ${error.message}`);
    }
  }
}
