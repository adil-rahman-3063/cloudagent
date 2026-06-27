import chalk from 'chalk';
import prompts from 'prompts';
import { gmailList, gmailRead, gmailSend, gmailModifyLabels } from './tools/gmail.js';
import { driveSearch, driveDownload, driveUpload } from './tools/drive.js';
import { calendarList, calendarCreate } from './tools/calendar.js';
import { gitStatus, gitPull, gitCommit, gitPush, githubRepoCreate } from './tools/git.js';
import { fileList, fileRead, fileWrite, fileDelete, fileCd, fileFindProjects } from './tools/filesystem.js';
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

// Returns schemas for the AI prompt
export function getToolsSchema() {
  return Object.values(REGISTRY).map(tool => ({
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
    } else {
      console.log(chalk.yellow(`\n🔔 CloudAgent wants to execute a state-changing tool:`));
    }

    if (toolName === 'gmail_send') {
      // Escape newlines for visual presentation
      const cleanBody = String(args.body || '').replace(/\n/g, '\\n');
      console.log(`Proposed Command: ${chalk.cyan(`/send ${args.to} "${args.subject}" "${cleanBody}"`)}`);
    } else {
      console.log(`Tool: ${chalk.bold(toolName)}`);
      console.log(`Arguments:\n${chalk.cyan(JSON.stringify(args, null, 2))}`);
    }
    
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: isWarning ? chalk.red('Approve this high-risk action?') : 'Approve execution?',
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
