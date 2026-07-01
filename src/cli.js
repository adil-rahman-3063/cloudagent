#!/usr/bin/env node

import chalk from 'chalk';
import prompts from 'prompts';
import ora from 'ora';
import readline from 'readline';
import { runDiagnostics, ensureGwsInstalled } from './doctor.js';
import { readConfig, writeConfig, setProviderKey, setWorkspaceAllowed, workspaceAllowed, readModels } from './config.js';
import { initDatabase, createSession, saveMessage, getSessionMessages, getLastSession, getSessions, clearAllSessions, deleteSession, updateSessionName } from './db.js';
import { askAgent, getActiveProvider } from './agent.js';
import { getToolsSchema, executeTool, REGISTRY } from './tool-registry.js';
import { PROVIDERS } from './providers/models.js';
import { tryFormatSuccess } from './formatter.js';
import path from 'path';
import fs from 'fs';
import { execFileSync, execSync } from 'child_process';

// Parse command line arguments
const args = process.argv.slice(2);

// Global status cache
let gwsUserEmail = '';

function displayHelp() {
  console.log(chalk.bold.cyan('\n🛠️  CloudAgent Capabilities & Tools'));
  console.log(chalk.dim('Here is what I can do to help you in your workspace:\n'));

  // 1. Gmail
  console.log(chalk.bold.magenta('📧 Gmail'));
  console.log(`  - ${chalk.green('List emails')}: Search and list recent emails. (e.g., "List my unread emails")`);
  console.log(`  - ${chalk.green('Read emails')}: View details of specific threads. (e.g., "Read the email about the project launch")`);
  console.log(`  - ${chalk.green('Send emails')}: Compose and send new emails. (e.g., "Send email to bob@example.com asking for feedback")`);
  console.log('');

  // 2. Drive
  console.log(chalk.bold.yellow('📂 Google Drive'));
  console.log(`  - ${chalk.green('Search files')}: Query documents or folders. (e.g., "Find spreadsheets modified last week")`);
  console.log(`  - ${chalk.green('Download files')}: Retrieve files to your local system. (e.g., "Download presentation.pdf")`);
  console.log(`  - ${chalk.green('Upload files')}: Save local files to Google Drive. (e.g., "Upload report.csv")`);
  console.log('');

  // 3. Calendar
  console.log(chalk.bold.blue('📅 Google Calendar'));
  console.log(`  - ${chalk.green('List events')}: Retrieve scheduled meetings. (e.g., "Show me my meetings tomorrow")`);
  console.log(`  - ${chalk.green('Create events')}: Schedule new calendar meetings. (e.g., "Schedule a call with Sarah next Monday at 2pm")`);
  console.log('');

  // 4. Tasks
  console.log(chalk.bold.hex('#FF8C00')('🧡 Google Tasks'));
  console.log(`  - ${chalk.green('List tasks')}: View tasks on your Google lists. (e.g., "What tasks do I have remaining?")`);
  console.log(`  - ${chalk.green('Create tasks')}: Add new tasks or to-do items. (e.g., "Add a task to buy groceries tomorrow")`);
  console.log('');

  // 5. Git
  console.log(chalk.bold.cyan('🌿 Git & GitHub'));
  console.log(`  - ${chalk.green('Status check')}: Check current git status. (e.g., "Show git status")`);
  console.log(`  - ${chalk.green('Commit changes')}: Stage and commit local modifications. (e.g., "Commit current changes with message 'Update CLI'")`);
  console.log(`  - ${chalk.green('Push/Pull code')}: Synchronize code with remote repositories. (e.g., "Pull the latest updates from git")`);
  console.log(`  - ${chalk.green('Create repository')}: Initialize and upload to a new GitHub repo. (e.g., "Create a GitHub repository for this project")`);
  console.log('');

  // 6. Filesystem
  const fsStatus = workspaceAllowed ? '' : chalk.red(' [DISABLED - Access Restricted]');
  console.log(chalk.bold.green('💻 Local Filesystem') + fsStatus);
  console.log(`  - ${chalk.green('List files')}: Inspect directory structures. (e.g., "List files in the current folder")`);
  console.log(`  - ${chalk.green('Read files')}: View the contents of local files. (e.g., "Read the content of package.json")`);
  console.log(`  - ${chalk.green('Write files')}: Create or modify local files. (e.g., "Write a simple script to test this endpoint")`);
  console.log(`  - ${chalk.green('Delete files')}: Remove local files securely. (e.g., "Delete the temp.json file")`);
  console.log('');

  // 7. Direct commands
  console.log(chalk.bold.white('⚡ Direct Commands'));
  console.log(`  - ${chalk.cyan('/help')} or ${chalk.cyan('what can i do')}: Print this capabilities screen.`);
  console.log(`  - ${chalk.cyan('/doctor')}: Run environment diagnostic checks.`);
  console.log(`  - ${chalk.cyan('/send')}: Directly send an email without LLM parsing (e.g., \`/send email@example.com "subject" "body"\`).`);
  console.log(`  - ${chalk.cyan('/exit')}: Safely terminate the CLI loop.`);
  console.log('');
}

function parseCommandArgs(input) {
  const args = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  
  const cmdText = input.trim();
  
  for (let i = 0; i < cmdText.length; i++) {
    const char = cmdText[i];
    
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    
    if (char === "'" && !inDoubleQuote) {
      const prevChar = i > 0 ? cmdText[i - 1] : '';
      const nextChar = i < cmdText.length - 1 ? cmdText[i + 1] : '';
      const isApostrophe = prevChar && /[a-zA-Z]/.test(prevChar) && nextChar && /[a-zA-Z]/.test(nextChar);
      
      if (isApostrophe) {
        current += char;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    
    if (char === ' ' && !inDoubleQuote && !inSingleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    
    current += char;
  }
  
  if (current.length > 0) {
    args.push(current);
  }
  
  return args;
}

async function askSaveAndRenameChat(sessionId) {
  // Let's prompt user if they want to save this session
  const savePrompt = await prompts({
    type: 'confirm',
    name: 'save',
    message: 'Would you like to save this chat session?',
    initial: true
  });

  if (savePrompt.save) {
    // Save/rename with AI
    console.log(chalk.cyan('\nRenaming session using AI based on chat contents...'));
    const spinner = ora('Generating title...').start();
    try {
      const messages = getSessionMessages(sessionId);
      if (!messages || messages.length === 0) {
        spinner.stop();
        updateSessionName(sessionId, 'Empty Chat');
        console.log(chalk.green('Session saved as "Empty Chat".'));
        return;
      }
      
      const formattedHistory = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => {
          let content = m.content;
          try {
            const parsed = JSON.parse(content);
            if (parsed.thought) {
              content = parsed.thought;
            } else if (parsed.tool) {
              content = `[Tool Call: ${parsed.tool}]`;
            }
          } catch (e) {}
          return `${m.role}: ${content}`;
        })
        .join('\n');

      const renamePrompt = [
        {
          role: 'user',
          content: `You are a helper that summarizes a chat conversation into a short title. Generate a concise, descriptive title (maximum 4-5 words, no quotation marks or prefixes) summarizing the following conversation:\n\n${formattedHistory}`
        }
      ];

      const provider = getActiveProvider();
      const result = await provider.generateToolCall(renamePrompt, []);
      const title = (result.text || result.thought || 'Saved Chat').trim().replace(/['"]/g, '');
      spinner.stop();
      if (title) {
        updateSessionName(sessionId, title);
        console.log(chalk.green(`Session saved as: "${title}"`));
      } else {
        updateSessionName(sessionId, 'Saved Chat');
        console.log(chalk.green('Session saved.'));
      }
    } catch (e) {
      spinner.stop();
      updateSessionName(sessionId, 'Saved Chat');
      console.log(chalk.green('Session saved.'));
    }
  } else {
    // Delete session from DB
    deleteSession(sessionId);
    console.log(chalk.yellow('Session discarded.'));
  }
}

async function handleInteractiveSubmenu(service, sessionId) {
  const subchoices = [];
  if (service === 'gmail') {
    subchoices.push(
      { title: '📋 List unread emails (gmail_list)', value: 'gmail_list' },
      { title: '✉️  Send a new email (gmail_send)', value: 'gmail_send' },
      { title: '🏷️  Modify labels / Mark as read (gmail_modify_labels)', value: 'gmail_modify_labels' }
    );
  } else if (service === 'drive') {
    subchoices.push(
      { title: '🔍 Search files/folders (drive_search)', value: 'drive_search' },
      { title: '📥 Download a file (drive_download)', value: 'drive_download' },
      { title: '📤 Upload a file (drive_upload)', value: 'drive_upload' }
    );
  } else if (service === 'calendar') {
    subchoices.push(
      { title: '📋 List agenda/schedule (calendar_list)', value: 'calendar_list' },
      { title: '➕ Create a calendar event (calendar_create)', value: 'calendar_create' }
    );
  } else if (service === 'tasks') {
    subchoices.push(
      { title: '📋 List tasks (tasks_list)', value: 'tasks_list' },
      { title: '➕ Create a task (tasks_create)', value: 'tasks_create' },
      { title: '✏️  Update/Complete a task (tasks_update)', value: 'tasks_update' }
    );
  } else if (service === 'filesystem') {
    subchoices.push(
      { title: '📋 List files in directory (file_list)', value: 'file_list' },
      { title: '📖 Read local file contents (file_read)', value: 'file_read' },
      { title: '✏️  Write content to file (file_write)', value: 'file_write' },
      { title: '❌ Delete local file (file_delete)', value: 'file_delete' },
      { title: '📁 Change directory (file_cd)', value: 'file_cd' },
      { title: '🔍 Find project folders (file_find_projects)', value: 'file_find_projects' }
    );
  } else if (service === 'git') {
    subchoices.push(
      { title: '📋 Git status (git_status)', value: 'git_status' },
      { title: '📥 Git pull (git_pull)', value: 'git_pull' },
      { title: '✏️  Git commit changes (git_commit)', value: 'git_commit' },
      { title: '📤 Git push changes (git_push)', value: 'git_push' },
      { title: '➕ Create GitHub repository (github_repo_create)', value: 'github_repo_create' }
    );
  }

  subchoices.push(
    { title: '⌨️  Type custom prompt...', value: 'custom' },
    { title: '❌ Cancel', value: 'cancel' }
  );

  const subSelect = await prompts({
    type: 'select',
    name: 'action',
    message: `Configure action for ${service.toUpperCase()}:`,
    choices: subchoices
  });

  if (!subSelect.action || subSelect.action === 'cancel') {
    return null;
  }

  if (subSelect.action === 'custom') {
    const customPrompt = await prompts({
      type: 'text',
      name: 'text',
      message: `Type custom prompt for ${service.toUpperCase()}:`
    });
    if (customPrompt.text?.trim()) {
      return `${customPrompt.text.trim()} (Category: ${service})`;
    }
    return null;
  }

  return `Execute ${subSelect.action} tool`;
}

async function handleInteractiveMenu(sessionId) {
  while (true) {
    const mainSelect = await prompts({
      type: 'select',
      name: 'service',
      message: 'Choose a service category:',
      choices: [
        { title: '📧 Gmail (Emails)', value: 'gmail' },
        { title: '📁 Google Drive', value: 'drive' },
        { title: '📅 Google Calendar', value: 'calendar' },
        { title: '✅ Google Tasks', value: 'tasks' },
        { title: '💻 Local Filesystem', value: 'filesystem' },
        { title: '🔧 Git & GitHub', value: 'git' },
        { title: '❌ Cancel', value: 'cancel' }
      ]
    });

    if (!mainSelect.service || mainSelect.service === 'cancel') {
      return null;
    }

    const selected = await handleInteractiveSubmenu(mainSelect.service, sessionId);
    if (selected) {
      return selected;
    }
  }
}

function waitForKeypress() {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    const handler = (str, key) => {
      process.stdin.pause();
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeListener('keypress', handler);
      resolve({ str, key });
    };
    process.stdin.on('keypress', handler);
  });
}

function drawDashboard() {
  const colWidth = 47;
  const config = readConfig();
  const providerMeta = PROVIDERS[config.active_provider || 'openrouter'];
  const activeModel = config.active_model || providerMeta?.defaultModel || 'openrouter/free';
  const cwd = process.cwd();

  const pad = (str, len) => {
    const rawLen = str.replace(/\u001b\[\d+m/g, '').length;
    return str + ' '.repeat(Math.max(0, len - rawLen));
  };

  const borderTop    = '┌' + '─'.repeat(colWidth) + '┬' + '─'.repeat(colWidth) + '┐';
  const borderBottom = '└' + '─'.repeat(colWidth) + '┴' + '─'.repeat(colWidth) + '┘';

  const leftRows = [
    chalk.bold(' Accessing workspace:'),
    ` ${cwd.length > colWidth - 2 ? '...' + cwd.substring(cwd.length - (colWidth - 5)) : cwd}`,
    '',
    chalk.bold(' Active model:'),
    ` ${activeModel.length > colWidth - 2 ? activeModel.substring(0, colWidth - 5) + '...' : activeModel}`
  ];

  const rightRows = [
    chalk.bold(' Available Capabilities:'),
    ` ${chalk.cyan('•')} Gmail (read, send, labels)`,
    ` ${chalk.cyan('•')} Google Drive & Local FS`,
    ` ${chalk.cyan('•')} Google Calendar (agenda)`,
    ` ${chalk.cyan('•')} Google Tasks & Git/GitHub`
  ];

  console.log(chalk.cyan(borderTop));
  for (let i = 0; i < 5; i++) {
    const left = pad(leftRows[i] || '', colWidth);
    const right = pad(rightRows[i] || '', colWidth);
    console.log(`${chalk.cyan('│')}${left}${chalk.cyan('│')}${right}${chalk.cyan('│')}`);
  }
  console.log(chalk.cyan(borderBottom));
}

function stopSpinner(state) {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  if (state.spinner) {
    state.spinner.stop();
    state.spinner = null;
  }
}

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
  console.log('\n' +
    chalk.hex('#00ffff').bold('  ▄████▄   ██       ██████  ██    ██ ██████   █████   ██████  ███████ ███    ██ ████████ \n') +
    chalk.hex('#00d7ff').bold(' ██▀      ██       ██    ██ ██    ██ ██   ██ ██   ██ ██       ██      ████   ██    ██    \n') +
    chalk.hex('#00afff').bold(' ██       ██       ██    ██ ██    ██ ██   ██ ███████ ██   ███ █████   ██ ██  ██    ██    \n') +
    chalk.hex('#0087ff').bold(' ██▄      ██       ██    ██ ██    ██ ██   ██ ██   ██ ██    ██ ██      ██  ██ ██    ██    \n') +
    chalk.hex('#005fff').bold('  ▀████▀  ███████   ██████   ▀████▀  ██████  ██   ██  ██████  ███████ ██   ████    ██    ')
  );
  console.log(chalk.bold.dim('                     Your local AI agent for Google Workspace & local systems\n'));

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
  const sessions = getSessions();
  let sessionId = '';
  
  if (sessions && sessions.length > 0) {
    const choices = sessions.map(s => {
      let timeStr = '';
      try {
        // Convert SQL UTC datetime to local time string
        const dateObj = new Date(s.updated_at + ' UTC');
        timeStr = ` (${isNaN(dateObj.getTime()) ? s.updated_at : dateObj.toLocaleString()})`;
      } catch (e) {
        timeStr = ` (${s.updated_at})`;
      }
      return {
        title: `Resume: "${s.name}"${timeStr}`,
        value: s.id
      };
    });
    choices.push({ title: '🆕 Start a new session', value: 'new' });
    
    const resumePrompt = await prompts({
      type: 'select',
      name: 'action',
      message: 'Choose a session to resume or start a new one:',
      choices
    });
    
    if (resumePrompt.action && resumePrompt.action !== 'new') {
      sessionId = resumePrompt.action;
      const matched = sessions.find(s => s.id === sessionId);
      console.log(chalk.green(`Resumed session: ${matched.name}\n`));
      const messages = getSessionMessages(sessionId);
      
      // Restore working directory from last successful file_cd in the session
      let lastDir = null;
      for (const msg of messages) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.status === 'success' && parsed.tool === 'file_cd') {
            const match = parsed.output.match(/Changed working directory to:\s*(.*)/);
            if (match && match[1]) {
              lastDir = match[1].trim();
            }
          }
        } catch (e) {
          // ignore
        }
      }
      if (lastDir && fs.existsSync(lastDir)) {
        try {
          process.chdir(lastDir);
        } catch (e) {
          // ignore
        }
      }
      
      if (messages && messages.length > 0) {
        // Filter out tool calls, tool results, and system instructions to show only the conversation
        const chatLog = messages
          .filter(msg => {
            const isToolLog = msg.content.startsWith('{') && (msg.content.includes('"tool"') || msg.content.includes('"status"'));
            const isSystemInstruction = msg.content.includes('[System Instruction:');
            const isToolSuccessMsg = msg.content.startsWith('Tool execution');
            return !isToolLog && !isSystemInstruction && !isToolSuccessMsg;
          })
          .slice(-3);

        if (chatLog.length > 0) {
          console.log(chalk.bold.dim('💬 Recent Conversation:'));
          for (const msg of chatLog) {
            const label = msg.role === 'user' ? chalk.bold.green('👤 You:') : chalk.bold.cyan('🤖 Agent:');
            let text = msg.content;
            
            // Strip out time context or system context from user message
            const contextIndex = text.indexOf('[System Context:');
            if (contextIndex !== -1) {
              text = text.substring(0, contextIndex).trim();
            }
            if (text) {
              console.log(`  ${label} ${chalk.dim(text)}`);
            }
          }
          console.log('');
        }
      }
    }
  }

  if (!sessionId) {
    sessionId = 'session_' + Date.now();
    createSession(sessionId);
  }

  // Check GWS authentication status on startup
  try {
    const statusOutput = execSync('gws auth status', { stdio: 'pipe' }).toString();
    const statusObj = JSON.parse(statusOutput);
    if (statusObj && (statusObj.token_valid === true || statusObj.status === 'success')) {
      gwsUserEmail = statusObj.user || statusObj.account || '';
    }
  } catch (e) {
    // ignore
  }

  // Draw dashboard
  console.log('');
  drawDashboard();
  console.log('');

  // Start chat loop
  while (true) {
    const currentFolder = process.cwd();
    
    console.log(chalk.dim('─'.repeat(98)));
    
    // Status info line right above prompt
    const loginStatus = gwsUserEmail 
      ? chalk.dim(`GWS Account: ${chalk.green(gwsUserEmail)}`) 
      : chalk.dim(`GWS Account: ${chalk.red('Not logged in · Please run gws auth login')}`);
    
    console.log(` ${loginStatus}`);
    console.log(` ${chalk.bold.cyan('❯')} `);
    console.log(chalk.dim('  ? for shortcuts · / for menu · Ctrl+C to exit'));
    
    // Move cursor up 2 lines and after " ❯ "
    readline.moveCursor(process.stdout, 0, -2);
    readline.cursorTo(process.stdout, 4);

    const { str, key } = await waitForKeypress();

    if (key && key.ctrl && key.name === 'c') {
      // Move cursor below the footer before exiting
      readline.moveCursor(process.stdout, 0, 2);
      console.log(chalk.cyan('\nGoodbye!'));
      process.exit(0);
    }

    let prompt = '';

    if (str === '/') {
      // Clear the shortcuts footer line
      readline.moveCursor(process.stdout, 0, 2);
      readline.clearLine(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -2);

      const selectedPrompt = await handleInteractiveMenu(sessionId);
      if (!selectedPrompt) continue;
      prompt = selectedPrompt;
    } else {
      if (str) {
        process.stdin.unshift(Buffer.from(str));
      }
      
      const userInput = await prompts({
        type: 'text',
        name: 'text',
        message: ''
      });
      
      prompt = userInput.text?.trim();

      // Clear the shortcuts footer line
      readline.moveCursor(process.stdout, 0, 1);
      readline.clearLine(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -1);
    }

    if (!prompt) continue;

    if (prompt.startsWith('/')) {
      const parts = prompt.split(' ');
      const cmd = parts[0].substring(1).toLowerCase();
      const categories = ['gmail', 'drive', 'calendar', 'tasks', 'filesystem', 'git'];
      if (categories.includes(cmd)) {
        const selectedPrompt = await handleInteractiveSubmenu(cmd, sessionId);
        if (!selectedPrompt) continue;
        prompt = selectedPrompt;
      }
    }

    // Check for ambiguous "drive" references
    const lowerPrompt = prompt.toLowerCase();
    const hasDrive = /\bdri*ve\b/.test(lowerPrompt);
    const hasGoogle = /google/.test(lowerPrompt) || /gdrive/.test(lowerPrompt);
    const hasLocal = /local/.test(lowerPrompt) || /\bc:\b/.test(lowerPrompt) || /computer/.test(lowerPrompt) || /pc\b/.test(lowerPrompt) || /hard\s*drive/.test(lowerPrompt);

    if (hasDrive && !hasGoogle && !hasLocal) {
      const clarification = await prompts({
        type: 'select',
        name: 'choice',
        message: 'Clarify destination:',
        choices: [
          { title: 'Google Drive', value: 'google' },
          { title: 'Local Drive (C:)', value: 'local' }
        ]
      });
      if (clarification.choice === 'google') {
        prompt += ' (Clarification: user meant Google Drive)';
      } else if (clarification.choice === 'local') {
        prompt += ' (Clarification: user meant local computer C: drive)';
      }
    }

    if (prompt === '/exit' || prompt === 'exit') {
      await askSaveAndRenameChat(sessionId);
      console.log(chalk.cyan('\nGoodbye!'));
      break;
    }

    if (prompt === '/delete-all' || prompt === '/clear') {
      const confirmClear = await prompts({
        type: 'confirm',
        name: 'value',
        message: chalk.red('Are you sure you want to delete ALL chat sessions and history?'),
        initial: false
      });
      if (confirmClear.value) {
        clearAllSessions();
        console.log(chalk.green('All chat sessions and history deleted successfully.'));
        sessionId = 'session_' + Date.now();
        createSession(sessionId);
      }
      continue;
    }

    if (prompt === '/doctor') {
      await runDiagnostics();
      continue;
    }

    if (prompt === '/help' || prompt === 'help' || prompt.toLowerCase() === 'what can i do' || prompt.toLowerCase() === 'what can you do') {
      displayHelp();
      continue;
    }

    const isSendEmailPrompt = 
      prompt.startsWith('/send') || 
      /^(lets\s+)?send\s+(an\s+)?email$/i.test(prompt) ||
      /^email$/i.test(prompt);

    if (isSendEmailPrompt) {
      const parsedArgs = parseCommandArgs(prompt);
      if (prompt.startsWith('/send') && parsedArgs.length >= 4) {
        const to = parsedArgs[1];
        const subject = parsedArgs[2];
        const body = parsedArgs.slice(3).join(' ');
        
        console.log(chalk.cyan(`\n🛠️ Direct Email Send initiated...`));
        const toolResult = await executeTool('gmail_send', { to, subject, body }, sessionId, false);
        if (toolResult.success) {
          console.log(chalk.green('\nEmail sent successfully!'));
        } else {
          console.log(chalk.red(`\nFailed to send email: ${toolResult.error}`));
        }
        continue;
      }

      console.log(chalk.bold.cyan('\n📧 Email Dispatch Options'));
      const choice = await prompts({
        type: 'select',
        name: 'mode',
        message: 'How would you like to draft this email?',
        choices: [
          { title: '✍️ Manual (Enter details one-by-one)', value: 'manual' },
          { title: '🤖 AI (Draft automatically from description)', value: 'ai' }
        ]
      });

      if (!choice.mode) continue;

      if (choice.mode === 'manual') {
        console.log(chalk.dim('\nEnter email details:'));
        const details = await prompts([
          {
            type: 'text',
            name: 'to',
            message: 'Recipient Email:',
            validate: val => val.trim().length > 0 || 'Recipient is required.'
          },
          {
            type: 'text',
            name: 'subject',
            message: 'Subject Line:',
            validate: val => val.trim().length > 0 || 'Subject is required.'
          },
          {
            type: 'text',
            name: 'body',
            message: 'Email Body:',
            validate: val => val.trim().length > 0 || 'Body is required.'
          }
        ]);

        if (details.to && details.subject && details.body) {
          console.log(chalk.cyan(`\n🛠️ Sending email...`));
          const toolResult = await executeTool('gmail_send', { to: details.to, subject: details.subject, body: details.body }, sessionId, false);
          if (toolResult.success) {
            console.log(chalk.green('\nEmail sent successfully!'));
          } else {
            console.log(chalk.red(`\nFailed to send email: ${toolResult.error}`));
          }
        } else {
          console.log(chalk.yellow('\nEmail dispatch cancelled.'));
        }
      } else {
        const aiPrompt = await prompts({
          type: 'text',
          name: 'desc',
          message: 'What is this email about? (Describe the contents):',
          validate: val => val.trim().length > 0 || 'Description is required.'
        });

        if (aiPrompt.desc) {
          await runAgentStep(sessionId, `Draft and send an email based on this description: ${aiPrompt.desc}`, { isSilent: false, spinner: null });
        } else {
          console.log(chalk.yellow('\nEmail dispatch cancelled.'));
        }
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
    state.startTime = Date.now();
    state.spinner = ora({
      text: 'Thinking... (0s)',
      spinner: {
        interval: 150,
        frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      },
      color: 'cyan'
    }).start();

    state.intervalId = setInterval(() => {
      if (state.spinner) {
        const secs = Math.floor((Date.now() - state.startTime) / 1000);
        state.spinner.text = `Thinking... (${secs}s)`;
      }
    }, 1000);
  } else {
    state.spinner.text = 'Thinking...';
  }
  
  try {
    const history = getSessionMessages(sessionId);
    const tools = getToolsSchema(history);

    // Call LLM
    const response = await askAgent(history, tools);

    if (response.thought && !state.isSilent) {
      const nextTool = response.tool ? REGISTRY[response.tool] : null;
      const isNextToolSafe = nextTool && nextTool.risk === 'safe';
      if (!isNextToolSafe) {
        stopSpinner(state);
        state.startTime = Date.now();
        state.spinner = ora({
          text: 'Thinking... (0s)',
          spinner: {
            interval: 150,
            frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
          },
          color: 'cyan'
        }).start();

        state.intervalId = setInterval(() => {
          if (state.spinner) {
            const secs = Math.floor((Date.now() - state.startTime) / 1000);
            state.spinner.text = `Thinking... (${secs}s)`;
          }
        }, 1000);
      }
    }

    if (response.tool) {
      // Save proposed tool call to history so follow-up requests have full context
      saveMessage(sessionId, 'assistant', JSON.stringify({
        thought: response.thought,
        tool: response.tool,
        arguments: response.arguments
      }));

      const tool = REGISTRY[response.tool];
      const isSafe = tool && tool.risk === 'safe';

      if (isSafe) {
        state.isSilent = true;
        if (state.intervalId) {
          clearInterval(state.intervalId);
          state.intervalId = null;
        }
        if (state.spinner) {
          let toolDesc = `Running ${response.tool}...`;
          if (response.tool.startsWith('gmail_')) {
            toolDesc = 'Running gws (Gmail)...';
          } else if (response.tool.startsWith('drive_')) {
            toolDesc = 'Running gws (Drive)...';
          } else if (response.tool.startsWith('calendar_')) {
            toolDesc = 'Running gws (Calendar)...';
          } else if (response.tool.startsWith('tasks_')) {
            toolDesc = 'Running gws (Tasks)...';
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

          await runAgentStep(sessionId, `Tool execution success for ${response.tool}. [System Instruction: The tool has executed successfully. Please present the result to the user. Do not start or trigger any other tools or tasks from earlier in the chat history unless the user explicitly requests them in a new prompt.]`, state);
        } else {
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'failed', 
            tool: response.tool, 
            error: toolResult.error 
          }));
          await runAgentStep(sessionId, `Tool execution failed for ${response.tool}: ${toolResult.error} [System Instruction: The tool execution failed. Please report the error to the user. Do not start or trigger any other tools or tasks from earlier in the chat history unless the user explicitly requests them in a new prompt.]`, state);
        }
      } else {
        // Non-safe tool (confirm / high risk)
        stopSpinner(state);
        state.isSilent = false;

        console.log(chalk.cyan(`\n🛠️ AI triggered tool: ${chalk.bold(response.tool)}`));
        
        const toolResult = await executeTool(response.tool, response.arguments || {}, sessionId, false);
        
        if (toolResult.success) {
          console.log(tryFormatSuccess(response.tool, toolResult.output));
          
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'success', 
            tool: response.tool, 
            output: toolResult.output 
          }));

          await runAgentStep(sessionId, `Tool execution success for ${response.tool}. [System Instruction: The tool has executed successfully. Please present the result to the user. Do not start or trigger any other tools or tasks from earlier in the chat history unless the user explicitly requests them in a new prompt.]`, state);
        } else {
          console.log(chalk.red(`\nTool error: ${toolResult.error}`));
          saveMessage(sessionId, 'assistant', JSON.stringify({ 
            status: 'failed', 
            tool: response.tool, 
            error: toolResult.error 
          }));
          if (toolResult.error === 'Execution rejected by user') {
            stopSpinner(state);
            return;
          }
          await runAgentStep(sessionId, `Tool execution failed for ${response.tool}: ${toolResult.error} [System Instruction: The tool execution failed. Please report the error to the user. Do not start or trigger any other tools or tasks from earlier in the chat history unless the user explicitly requests them in a new prompt.]`, state);
        }
      }
    } else if (response.text) {
      stopSpinner(state);
      console.log(`\n${chalk.bold.cyan('🤖 Agent:')} ${response.text}\n`);
      saveMessage(sessionId, 'assistant', response.text);
    } else if (response.thought) {
      // The model only generated a thought, but didn't output a tool call or a text response.
      // Re-prompt the model to proceed to the actual action.
      saveMessage(sessionId, 'assistant', JSON.stringify({ thought: response.thought }));
      await runAgentStep(sessionId, "You only provided a 'thought'. Please output a valid JSON containing either a 'tool' to execute or a 'text' response for the user.", state);
    } else {
      stopSpinner(state);
      console.log(chalk.red('\nReceived invalid or empty response format from AI.'));
      console.log(chalk.dim(`Raw parsed response: ${JSON.stringify(response)}`));
    }

  } catch (error) {
    stopSpinner(state);
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
