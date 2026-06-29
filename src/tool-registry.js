import path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';
import { gmailList, gmailRead, gmailSend, gmailModifyLabels } from './tools/gmail.js';
import { driveSearch, driveDownload, driveUpload } from './tools/drive.js';
import { calendarList, calendarCreate } from './tools/calendar.js';
import { gitStatus, gitPull, gitCommit, gitPush, githubRepoCreate } from './tools/git.js';
import { fileList, fileRead, fileWrite, fileDelete, fileCd, fileFindProjects, resolveSmartPath } from './tools/filesystem.js';
import { tasksList, tasksCreate, tasksUpdate } from './tools/tasks.js';
import { logToolRun, updateToolRun } from './db.js';

// Registry holding all tools
export const REGISTRY = {
  gmail_list: gmailList,
  gmail_read: gmailRead,
  gmail_send: gmailSend,
  gmail_modify_labels: gmailModifyLabels,
  drive_search: driveSearch,
  drive_download: driveDownload,
  drive_upload: driveUpload,
  calendar_list: calendarList,
  calendar_create: calendarCreate,
  git_status: gitStatus,
  git_pull: gitPull,
  git_commit: gitCommit,
  git_push: gitPush,
  github_repo_create: githubRepoCreate,
  file_list: fileList,
  file_read: fileRead,
  file_write: fileWrite,
  file_delete: fileDelete,
  file_cd: fileCd,
  file_find_projects: fileFindProjects,
  tasks_list: tasksList,
  tasks_create: tasksCreate,
  tasks_update: tasksUpdate
};

// Returns schemas for the AI prompt, filtered dynamically by history context keywords/categories
export function getToolsSchema(history = []) {
  const categories = [];

  // Combine all user prompts in history to extract keywords
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
  const combinedText = userMessages.join(' ');

  if (combinedText) {
    // Explicit category tag check (e.g. from interactive submenus)
    if (combinedText.includes('category: gmail')) categories.push('gmail');
    else if (combinedText.includes('category: drive')) categories.push('drive');
    else if (combinedText.includes('category: calendar')) categories.push('calendar');
    else if (combinedText.includes('category: tasks')) categories.push('tasks');
    else if (combinedText.includes('category: filesystem')) categories.push('file');
    else if (combinedText.includes('category: git')) categories.push('git', 'github');

    // Natural language keyword checks (only if no explicit category tag was matched yet)
    if (categories.length === 0) {
      if (/\b(email|mail|send|draft|inbox|recipient|sender)\b/.test(combinedText)) categories.push('gmail');
      if (/\b(drive|gdrive|upload|download|google\s+drive)\b/.test(combinedText)) categories.push('drive');
      if (/\b(calendar|schedule|meeting|event|agenda|tomorrow|today|yesterday|date)\b/.test(combinedText)) categories.push('calendar');
      if (/\b(task|todo|tasks|list\s+task|create\s+task)\b/.test(combinedText)) categories.push('tasks');
      if (/\b(file|folder|directory|cd|path|filesystem|read|write|delete)\b/.test(combinedText)) categories.push('file');
      if (/\b(git|github|repo|repository|commit|push|pull|clone|merge)\b/.test(combinedText)) categories.push('git', 'github');
    }
  }

  // Filter tools list based on identified categories
  let tools = Object.values(REGISTRY);
  if (categories.length > 0) {
    tools = tools.filter(tool => categories.some(cat => tool.name.startsWith(cat)));
  }

  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    risk: tool.risk
  }));
}

// Prompt and execute a tool
export async function executeTool(toolName, args, sessionId, silent = false) {
  const tool = REGISTRY[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found in registry`);
  }

  // Pre-log tool run as pending
  const runId = logToolRun(sessionId, toolName, args, 'pending');

  let approved = true;

  if (tool.risk === 'confirm' || tool.risk === 'high') {
    const isWarning = tool.risk === 'high';
    if (isWarning) {
      console.log(chalk.red.bold(`\n⚠️  WARNING: High-risk action requested!`));
    } else if (toolName === 'file_cd') {
      console.log(chalk.yellow(`\n🔒 Directory Navigation Permission Request:`));
    } else {
      console.log(chalk.yellow(`\n🔔 CloudAgent wants to execute a state-changing tool:`));
    }

    if (toolName === 'gmail_send') {
      // Escape newlines for visual presentation
      const cleanBody = String(args.body || '').replace(/\n/g, '\\n');
      console.log(`Proposed Command: ${chalk.cyan(`/send ${args.to} "${args.subject}" "${cleanBody}"`)}`);
    } else if (toolName === 'file_cd') {
      const resolvedPath = resolveSmartPath(args.dirPath);
      console.log(`Proposed Target Directory: ${chalk.cyan(resolvedPath)}`);
    } else {
      console.log(`Tool: ${chalk.bold(toolName)}`);
      console.log(`Arguments:\n${chalk.cyan(JSON.stringify(args, null, 2))}`);
    }
    
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: isWarning 
        ? chalk.red('Approve this high-risk action?') 
        : (toolName === 'file_cd' ? 'Allow access to navigate to this directory?' : 'Approve execution?'),
      initial: !isWarning
    });
    
    approved = response.value;
  }

  if (!approved) {
    updateToolRun(runId, 'rejected', 'Execution rejected by user');
    return { success: false, error: 'Execution rejected by user' };
  }

  updateToolRun(runId, 'approved', 'Execution approved');

  if (!silent) {
    console.log(chalk.dim(`\n⚙️ Running ${toolName}...`));
  }
  const result = await tool.execute(args);

  if (result.success) {
    updateToolRun(runId, 'success', result.output);
  } else {
    updateToolRun(runId, 'failed', result.error);
  }

  return result;
}
