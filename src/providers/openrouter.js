import { Provider } from './provider.js';
import { readModels, readConfig, writeConfig } from '../config.js';
import chalk from 'chalk';

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

Resolve references to folders, files, or previous contexts using the session history.

When the user requests an action (such as sending an email or creating an event) but does not provide all the required arguments (like recipient, subject, body, or time), do NOT try to call the tool with missing or empty parameters. Instead, reply directly to the user asking politely for the missing information (e.g., recipient email, subject, or message body) and offer to help draft the content if needed.

CRITICAL: When presenting retrieved results from listing or searching tools (like emails, calendar events, or files), format the output in a clean, user-friendly, conversational manner using grouped bullet points or natural language descriptions. Do NOT output markdown tables, raw JSON, or box-drawing characters.

CRITICAL: Do NOT generate placeholder text with brackets (such as "[Your Name]" or "[Sender]") in email bodies or drafts. If you need specific details to complete an email (such as the sender's name or other missing info), ask the user to provide or clarify them instead of generating bracketed placeholders, or simply omit the name from the sign-off (e.g., end with "Best regards," or "Thanks!").

CRITICAL: When the user asks you to perform an action (such as sending an email, creating an event, pulling git, writing files), and you have all the required parameters (or can generate them based on the context/draft), you MUST invoke the appropriate tool (e.g. gmail_send) to perform the action. Do NOT reply telling the user you cannot do it or asking them to do it manually, as you have tools specifically for these actions.

CRITICAL: When presenting dates and times to the user, always convert them from UTC (or any timezone returned by tools) to the user's local timezone using the offset specified in the metadata (e.g., +05:30). Display times in user-friendly local formats (e.g. "June 25 at 7:30 PM" or "8:00 PM today").`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map(m => ({ role: m.role, content: m.content }))
    ];

    // Determine the list of models to try (fallback strategy)
    const configuredModel = this.model;
    const modelList = readModels();
    
    // Ensure the configured model is tried first
    const modelsToTry = [];
    if (configuredModel) {
      modelsToTry.push(configuredModel);
    }
    for (const m of modelList) {
      if (!modelsToTry.includes(m)) {
        modelsToTry.push(m);
      }
    }
    if (modelsToTry.length === 0) {
      modelsToTry.push('openai/gpt-oss-120b:free');
    }

    let lastErrorMsg = 'Unknown error';

    for (const currentModel of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://github.com/googleworkspace/cli',
            'X-Title': 'CloudAgent'
          },
          body: JSON.stringify({
            model: currentModel,
            messages: messages,
            temperature: 0.1,
            response_format: { type: 'json_object' }
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Model ${currentModel} returned: ${response.status} ${errText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content || content.trim() === '' || content.trim() === '{}') {
          throw new Error('Model returned empty or invalid response content');
        }
        const rawText = content.trim();
        
        // Parse the response with robust error recovery
        const parsed = this.robustParseResponse(rawText);

        // Save the successful fallback model as the new active model
        if (currentModel !== configuredModel) {
          try {
            const config = readConfig();
            config.active_model = currentModel;
            writeConfig(config);
            this.model = currentModel;
          } catch (e) {
            // Ignore config write failures
          }
        }

        return parsed;

      } catch (error) {
        let cleanMsg = 'Unknown error';
        const msg = error.message || '';
        if (msg.includes('429')) {
          cleanMsg = 'Rate-limited (429)';
        } else if (msg.includes('404')) {
          cleanMsg = 'Model unavailable (404)';
        } else if (msg.includes('JSON parsing failed')) {
          cleanMsg = 'Invalid JSON response';
        } else {
          cleanMsg = msg.split(/[.:\n]/)[0].trim().substring(0, 100);
        }
        console.warn(chalk.yellow(`\n⚠️  Model failed: ${currentModel} (${cleanMsg}). Trying next fallback...`));
        lastErrorMsg = cleanMsg;
      }
    }

    throw new Error(`OpenRouter invocation failed. All fallback models exhausted. Last error: ${lastErrorMsg}`);
  }
}
