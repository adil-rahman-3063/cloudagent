#!/usr/bin/env node

import chalk from 'chalk';
import prompts from 'prompts';
import ora from 'ora';
import { runDiagnostics, ensureGwsInstalled } from './doctor.js';
import { readConfig, writeConfig, setProviderKey, setWorkspaceAllowed, readModels } from './config.js';
import { initDatabase, createSession, saveMessage, getSessionMessages, getLastSession } from './db.js';
import { askAgent } from './agent.js';
import { getToolsSchema, executeTool, REGISTRY } from './tool-registry.js';
import { PROVIDERS } from './providers/models.js';

// Parse command line arguments
const args = process.argv.slice(2);

async function main() {
  // Ensure DB and directories are configured
  initDatabase();

  if (args[0] === 'doctor') {
    const success = await runDiagnostics();
    process.exit(success ? 0 : 1);
  }

  if (args[0] === 'config') {
    await handleConfigSubcommand();
    process.exit(0);
  }

  // Regular startup
  console.log(chalk.bold.cyan('\n☁️  CloudAgent CLI'));
  console.log(chalk.dim('Your local AI agent for Google Workspace & local systems\n'));

  // Onboarding gws check
  await ensureGwsInstalled();

  // Workspace Path Permission check
  const currentDir = process.cwd();
  console.log(chalk.yellow(`🔒 Workspace Access Request:`));
  console.log(`CloudAgent is running in: ${chalk.bold(currentDir)}`);
  
  const permission = await prompts({
    type: 'confirm',
    name: 'allowed',
    message: 'Allow CloudAgent to read/write files in this directory?',
    initial: true
  });

  setWorkspaceAllowed(!!permission.allowed);
  if (!permission.allowed) {
    console.log(chalk.red('Restricted mode active: Local filesystem tools are disabled.\n'));
  } else {
    console.log(chalk.green('Workspace access granted.\n'));
  }

  // Quick sanity check for active key
  const config = readConfig();
  const activeProvider = config.active_provider;
  const activeKey = config.providers?.[activeProvider]?.api_key;

  if (!activeKey) {
    console.log(chalk.yellow(`No API Key configured for your active provider: ${chalk.bold(activeProvider)}`));
    const setup = await prompts({
      type: 'text',
      name: 'key',
      message: `Enter API Key for ${activeProvider}:`
    });
    if (setup.key) {
      setProviderKey(activeProvider, setup.key);
      console.log(chalk.green('API Key saved successfully.'));
    } else {
      console.log(chalk.red('Cannot run without an API Key. Run "cloudagent config" to configure.'));
      process.exit(1);
    }
  }

  // Start session
  const lastSession = getLastSession();
  let sessionId = '';
  
  if (lastSession) {
    console.log(chalk.cyan(`Found previous chat session: "${lastSession.name}"`));
    const resumePrompt = await prompts({
      type: 'select',
      name: 'action',
      message: 'Would you like to resume this session or start a new one?',
      choices: [
        { title: 'Resume previous session', value: 'resume' },
        { title: 'Start a new session', value: 'new' }
      ]
    });
    
    if (resumePrompt.action === 'resume') {
      sessionId = lastSession.id;
      console.log(chalk.green(`Resumed session: ${lastSession.name}\n`));
      
      const messages = getSessionMessages(sessionId);
      if (messages && messages.length > 0) {
        console.log(chalk.dim('--- Last messages in this session ---'));
        const lastThree = messages.slice(-3);
        for (const msg of lastThree) {
          const prefix = msg.role === 'user' ? chalk.green('cloudagent>') : chalk.bold('Agent:');
          let displayContent = msg.content;
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.tool) {
              displayContent = `[Executed tool: ${parsed.tool}]`;
            }
          } catch (e) {
            // plain text
          }
          console.log(chalk.dim(`${prefix} ${displayContent}`));
        }
        console.log(chalk.dim('-------------------------------------\n'));
      }
    }
  }

  if (!sessionId) {
    sessionId = 'session_' + Date.now();
    createSession(sessionId);
  }

  console.log(chalk.dim('Type your prompt or "/exit" to quit, "/doctor" for diagnostics, "/send" to send email directly.'));
  console.log(chalk.dim('Example: "List my 3 most recent emails" or "/send email@example.com \'Subject\' \'Body\'"'));
  console.log('');

  // Start chat loop
  while (true) {
    const userInput = await prompts({
      type: 'text',
      name: 'text',
      message: chalk.green('cloudagent>')
    });

    const prompt = userInput.text?.trim();

    if (!prompt) continue;

    if (prompt === '/exit' || prompt === 'exit') {
      console.log(chalk.cyan('\nGoodbye!'));
      break;
    }

    if (prompt === '/doctor') {
      await runDiagnostics();
      continue;
    }

    if (prompt.startsWith('/send')) {
      const matches = prompt.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g);
      if (matches && matches.length >= 4) {
        const to = matches[1].replace(/['"]/g, '');
        const subject = matches[2].replace(/['"]/g, '');
        const body = matches.slice(3).join(' ').replace(/['"]/g, '');
        
        console.log(chalk.cyan(`\n🛠️ Direct Email Send initiated...`));
        const toolResult = await executeTool('gmail_send', { to, subject, body }, sessionId, false);
        if (toolResult.success) {
          console.log(chalk.green('\nEmail sent successfully!'));
        } else {
          console.log(chalk.red(`\nFailed to send email: ${toolResult.error}`));
        }
      } else {
        console.log(chalk.yellow('\nUsage: /send <recipient> "<subject>" "<body>"'));
        console.log(chalk.dim('Example: /send adilrahiman.123@gmail.com "Party tomorrow" "Are you coming?"'));
      }
      continue;
    }

    // Call Agent
    await runAgentStep(sessionId, prompt, { isSilent: false, spinner: null });
  }
}

async function runAgentStep(sessionId, userPrompt, state = { isSilent: false, spinner: null }) {
  // Save message to database
  saveMessage(sessionId, 'user', userPrompt);

  if (!state.spinner) {
    state.spinner = ora('CloudAgent thinking...').start();
  } else {
    state.spinner.text = 'CloudAgent thinking...';
  }
  
  try {
    const history = getSessionMessages(sessionId);
    const tools = getToolsSchema();

    // Call LLM
    const response = await askAgent(history, tools);

    if (response.thought && !state.isSilent) {
      const nextTool = response.tool ? REGISTRY[response.tool] : null;
      const isNextToolSafe = nextTool && nextTool.risk === 'safe';
      if (!isNextToolSafe) {
        if (state.spinner) {
          state.spinner.stop();
          state.spinner = null;
        }
        console.log(chalk.dim(`\n🧠 Thought: ${response.thought}`));
        state.spinner = ora('CloudAgent thinking...').start();
      }
    }

    if (response.tool) {
      const tool = REGISTRY[response.tool];
      const isSafe = tool && tool.risk === 'safe';

      if (isSafe) {
        state.isSilent = true;
        if (state.spinner) {
          let toolDesc = `Running ${response.tool}...`;
          if (response.tool.startsWith('gmail_')) {
            toolDesc = 'Running gws (Gmail)...';
          } else if (response.tool.startsWith('drive_')) {
            toolDesc = 'Running gws (Drive)...';
          } else if (response.tool.startsWith('calendar_')) {
            toolDesc = 'Running gws (Calendar)...';
          }
          state.spinner.text = toolDesc;
        }
        const toolResult = await executeTool(response.tool, response.arguments || {}, sessionId, true);
        
        if (toolResult.success) {
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'success', 
            tool: response.tool, 
            output: toolResult.output 
          }));

          await runAgentStep(sessionId, `Tool execution success for ${response.tool}.`, state);
        } else {
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'failed', 
            tool: response.tool, 
            error: toolResult.error 
          }));
          await runAgentStep(sessionId, `Tool execution failed for ${response.tool}: ${toolResult.error}`, state);
        }
      } else {
        // Non-safe tool (confirm / high risk)
        if (state.spinner) {
          state.spinner.stop();
          state.spinner = null;
        }
        state.isSilent = false;

        console.log(chalk.cyan(`\n🛠️ AI triggered tool: ${chalk.bold(response.tool)}`));
        
        const toolResult = await executeTool(response.tool, response.arguments || {}, sessionId, false);
        
        if (toolResult.success) {
          console.log(toolResult.output);
          
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'success', 
            tool: response.tool, 
            output: toolResult.output 
          }));

          await runAgentStep(sessionId, `Tool execution success for ${response.tool}.`, state);
        } else {
          console.log(chalk.red(`\nTool error: ${toolResult.error}`));
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'failed', 
            tool: response.tool, 
            error: toolResult.error 
          }));
          await runAgentStep(sessionId, `Tool execution failed for ${response.tool}: ${toolResult.error}`, state);
        }
      }
    } else if (response.text || response.thought) {
      const finalMsg = response.text || response.thought;
      if (state.spinner) {
        state.spinner.stop();
        state.spinner = null;
      }
      const outputText = typeof finalMsg === 'object' ? JSON.stringify(finalMsg, null, 2) : finalMsg;
      console.log(`\n🤖 ${chalk.bold('Agent:')} ${outputText}\n`);
      saveMessage(sessionId, 'assistant', outputText);
    } else {
      if (state.spinner) {
        state.spinner.stop();
        state.spinner = null;
      }
      console.log(chalk.red('\nReceived invalid or empty response format from AI.'));
      console.log(chalk.dim(`Raw parsed response: ${JSON.stringify(response)}`));
    }

  } catch (error) {
    if (state.spinner) {
      state.spinner.stop();
      state.spinner = null;
    }
    console.error(chalk.red(`\nError: ${error.message}`));
  }
}

async function handleConfigSubcommand() {
  const config = readConfig();
  console.log(chalk.bold('\n⚙️  CloudAgent Configuration\n'));

  const action = await prompts({
    type: 'select',
    name: 'value',
    message: 'What would you like to configure?',
    choices: [
      { title: 'Switch Active Provider / Model', value: 'provider' },
      { title: 'Update Provider API Keys', value: 'key' },
      { title: 'Print Current Configuration', value: 'print' },
      { title: 'Exit', value: 'exit' }
    ]
  });

  if (action.value === 'provider') {
    const provChoice = await prompts({
      type: 'select',
      name: 'provider',
      message: 'Select AI Provider:',
      choices: Object.entries(PROVIDERS).map(([key, val]) => ({
        title: val.name,
        value: key
      }))
    });

    if (provChoice.provider) {
      let model = '';
      if (provChoice.provider === 'openrouter') {
        const availableModels = readModels();
        const modelSelection = await prompts({
          type: 'select',
          name: 'model',
          message: 'Select OpenRouter Model:',
          choices: [
            ...availableModels.map(m => ({ title: m, value: m })),
            { title: 'Custom Model (write in)', value: '__custom__' }
          ]
        });

        if (modelSelection.model === '__custom__') {
          const customPrompt = await prompts({
            type: 'text',
            name: 'model',
            message: 'Enter custom model name:'
          });
          model = customPrompt.model;
        } else {
          model = modelSelection.model;
        }
      } else {
        const modelChoice = await prompts({
          type: 'text',
          name: 'model',
          message: `Enter model name (default: ${PROVIDERS[provChoice.provider].defaultModel}):`,
          initial: PROVIDERS[provChoice.provider].defaultModel
        });
        model = modelChoice.model;
      }

      if (model) {
        config.active_provider = provChoice.provider;
        config.active_model = model;
        writeConfig(config);
        console.log(chalk.green(`\nActive provider set to ${provChoice.provider} (${model})`));
      }
    }
  } else if (action.value === 'key') {
    const provChoice = await prompts({
      type: 'select',
      name: 'provider',
      message: 'Configure key for which provider?',
      choices: Object.entries(PROVIDERS).map(([key, val]) => ({
        title: val.name,
        value: key
      }))
    });

    if (provChoice.provider) {
      const keyInput = await prompts({
        type: 'text',
        name: 'key',
        message: `Enter API key for ${PROVIDERS[provChoice.provider].name}:`
      });

      if (keyInput.key) {
        setProviderKey(provChoice.provider, keyInput.key);
        console.log(chalk.green('\nAPI Key configured successfully.'));
      }
    }
  } else if (action.value === 'print') {
    console.log(chalk.cyan(JSON.stringify(config, null, 2)));
  }
}

main().catch(err => {
  console.error(chalk.red(err.stack));
  process.exit(1);
});
