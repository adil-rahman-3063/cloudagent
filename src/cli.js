#!/usr/bin/env node

import chalk from 'chalk';
import prompts from 'prompts';
import ora from 'ora';
import { runDiagnostics, ensureGwsInstalled } from './doctor.js';
import { readConfig, writeConfig, setProviderKey, setWorkspaceAllowed } from './config.js';
import { initDatabase, createSession, saveMessage, getSessionMessages } from './db.js';
import { askAgent } from './agent.js';
import { getToolsSchema, executeTool } from './tool-registry.js';
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
  const sessionId = 'session_' + Date.now();
  createSession(sessionId);

  console.log(chalk.dim('Type your prompt or "/exit" to quit, "/doctor" for diagnostics.'));
  console.log(chalk.dim('Example: "List my 3 most recent emails" or "Check my git status"'));
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

    // Save user message to DB
    saveMessage(sessionId, 'user', prompt);

    // Call Agent
    await runAgentStep(sessionId, prompt);
  }
}

async function runAgentStep(sessionId, userPrompt) {
  const spinner = ora('CloudAgent thinking...').start();
  
  try {
    const history = getSessionMessages(sessionId);
    const tools = getToolsSchema();

    // Call LLM
    const response = await askAgent(history, tools);
    spinner.stop();

    if (response.thought) {
      console.log(chalk.dim(`\n🧠 Thought: ${response.thought}`));
    }

    if (response.tool) {
      console.log(chalk.cyan(`\n🛠️ AI triggered tool: ${chalk.bold(response.tool)}`));
      
      // Execute the tool
      const toolResult = await executeTool(response.tool, response.arguments || {}, sessionId);
      
      if (toolResult.success) {
        console.log(chalk.green(`\nOutput:`));
        console.log(toolResult.output);
        
        // Log result into history for model context
        saveMessage(sessionId, 'assistant', JSON.stringify({ 
          status: 'success', 
          tool: response.tool, 
          output: toolResult.output 
        }));

        // Re-call agent with tool output so it can answer the user
        await runAgentStep(sessionId, `Tool execution success for ${response.tool}.`);
      } else {
        console.log(chalk.red(`\nTool error: ${toolResult.error}`));
        saveMessage(sessionId, 'assistant', JSON.stringify({ 
          status: 'failed', 
          tool: response.tool, 
          error: toolResult.error 
        }));
        await runAgentStep(sessionId, `Tool execution failed for ${response.tool}: ${toolResult.error}`);
      }
    } else if (response.text) {
      console.log(`\n🤖 ${chalk.bold('Agent:')} ${response.text}\n`);
      saveMessage(sessionId, 'assistant', response.text);
    } else {
      console.log(chalk.red('\nReceived invalid or empty response format from AI.'));
    }

  } catch (error) {
    spinner.stop();
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
      const modelChoice = await prompts({
        type: 'text',
        name: 'model',
        message: `Enter model name (default: ${PROVIDERS[provChoice.provider].defaultModel}):`,
        initial: PROVIDERS[provChoice.provider].defaultModel
      });

      config.active_provider = provChoice.provider;
      config.active_model = modelChoice.model;
      writeConfig(config);
      console.log(chalk.green(`\nActive provider set to ${provChoice.provider} (${modelChoice.model})`));
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
