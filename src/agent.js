import { readConfig } from './config.js';
import { OpenRouterClient } from './providers/openrouter.js';
import { OpenAIClient } from './providers/openai.js';
import { GeminiClient } from './providers/gemini.js';
import { AnthropicClient } from './providers/anthropic.js';
import { PROVIDERS } from './providers/models.js';
import { REGISTRY } from './tool-registry.js';

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

export async function askAgent(chatHistory, tools, onModelAttempt) {
  const provider = getActiveProvider();
  
  // Inject current date/time context into the latest user message to prevent recency/resume bias
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeContext = `\n\n[System Context: The current local date and time is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} ${now.toLocaleTimeString('en-US')}. Timezone: ${timeZone} (Offset: ${-now.getTimezoneOffset()} minutes from UTC). Use this unambiguous date and time to accurately compute relative dates such as "today" (which is ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}), "tomorrow", "yesterday", etc. Do not confuse day and month.]`;

  let historyWithTime = [];
  const lastUserIdx = chatHistory.findLastIndex(m => m.role === 'user');
  if (lastUserIdx !== -1) {
    historyWithTime = chatHistory.map((msg, idx) => {
      if (idx === lastUserIdx) {
        return {
          ...msg,
          content: msg.content + timeContext
        };
      }
      return msg;
    });
  } else {
    historyWithTime = [
      {
        role: 'user',
        content: `[System Context: The current local date and time is ${now.toDateString()} ${now.toTimeString()}.]`
      },
      ...chatHistory
    ];
  }
  
  // Sanitize history to ensure strict user/assistant role alternation
  const sanitized = [];
  for (const msg of historyWithTime) {
    if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === msg.role) {
      if (msg.role === 'assistant') {
        sanitized.push({ role: 'user', content: 'Proceed.' });
      } else {
        sanitized.push({ role: 'assistant', content: 'Acknowledged.' });
      }
    }
    sanitized.push(msg);
  }

  let response = await provider.generateToolCall(sanitized, tools, onModelAttempt);

  // If the response parsed is an object but lacks tool and text keys, check if it's direct arguments
  if (response && typeof response === 'object' && !response.tool && !response.text) {
    const keys = Object.keys(response);
    if (keys.includes('fileId') || keys.includes('destination')) {
      response = {
        thought: 'Normalizing direct tool arguments to drive_download call',
        tool: 'drive_download',
        arguments: response
      };
    } else if (keys.includes('query') || keys.includes('folder')) {
      response = {
        thought: 'Normalizing direct tool arguments to drive_search call',
        tool: 'drive_search',
        arguments: response
      };
    } else if (keys.includes('to') && (keys.includes('subject') || keys.includes('body'))) {
      response = {
        thought: 'Normalizing direct tool arguments to gmail_send call',
        tool: 'gmail_send',
        arguments: response
      };
    } else if (keys.includes('path') && keys.includes('content')) {
      response = {
        thought: 'Normalizing direct tool arguments to file_write call',
        tool: 'file_write',
        arguments: response
      };
    }
  }

  // Normalize the response if the LLM gets confused and outputs tool: "text" / tool: "reply"
  if (response && response.tool) {
    if (typeof response.tool === 'object' && response.tool !== null) {
      if (response.tool.name) {
        response.tool = response.tool.name;
      }
    }
    if (typeof response.tool === 'string') {
      const toolName = response.tool.toLowerCase();
      if (toolName === 'text' || toolName === 'reply' || toolName === 'message' || toolName === 'none' || toolName === 'null') {
        const textVal = response.text || response.arguments?.text || response.arguments?.message || response.arguments?.reply || '';
        delete response.tool;
        delete response.arguments;
        response.text = textVal;
      } else if (toolName === 'google_tasks_list' || toolName === 'google_task_list' || toolName === 'task_list') {
        response.tool = 'tasks_list';
      } else if (toolName === 'google_tasks_create' || toolName === 'google_task_create' || toolName === 'task_create') {
        response.tool = 'tasks_create';
      } else if (toolName === 'google_tasks_update' || toolName === 'google_task_update' || toolName === 'task_update' || toolName === 'google_tasks_complete' || toolName === 'tasks_complete') {
        response.tool = 'tasks_update';
      } else if (toolName === 'change_directory' || toolName === 'change_dir' || toolName === 'cd') {
        response.tool = 'file_cd';
      } else if (toolName === 'find_projects' || toolName === 'list_projects' || toolName === 'get_projects') {
        response.tool = 'file_find_projects';
      } else if (toolName === 'gmail_mark_as_read' || toolName === 'gmail_modify_labels' || toolName === 'gmail_mark_read') {
        response.tool = 'gmail_modify_labels';
        if (toolName === 'gmail_mark_as_read' || toolName === 'gmail_mark_read') {
          response.arguments = response.arguments || {};
          response.arguments.removeLabelIds = ['UNREAD'];
        }
      }
    }
  }

  // Intercept and prevent gmail_send with empty or missing subjects or bodies
  if (response && response.tool === 'gmail_send') {
    const args = response.arguments || {};
    const to = (args.to || '').trim();
    const subject = (args.subject || '').trim();
    const body = (args.body || '').trim();

    if (!to || !subject || !body) {
      delete response.tool;
      delete response.arguments;
      if (!to) {
        response.text = "Please provide the recipient's email address to send the email.";
      } else if (!subject && !body) {
        response.text = `I'm ready to send the email to ${to}, but I need the subject and the body of the message. Could you please provide those?`;
      } else if (!subject) {
        response.text = `I have the recipient (${to}) and body, but I still need a subject line. What should the subject be?`;
      } else {
        response.text = `I have the recipient (${to}) and subject ("${subject}"), but the body of the message is empty. What would you like to say?`;
      }
    }
  } else if (response && !response.tool && !response.text) {
    // Check if the root level keys of the response satisfy the required arguments of any tool
    for (const [toolName, tool] of Object.entries(REGISTRY)) {
      const required = tool.schema?.required || [];
      if (required.length > 0 && required.every(key => key in response)) {
        const args = {};
        for (const key of Object.keys(tool.schema.properties || {})) {
          if (key in response) {
            args[key] = response[key];
            delete response[key];
          }
        }
        response.tool = toolName;
        response.arguments = args;
        response.thought = response.thought || `Auto-detected parameters for ${toolName}`;
        break;
      }
    }
  }

  return response;
}
