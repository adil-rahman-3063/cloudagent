import { execFileSync } from 'child_process';
import { workspaceAllowed } from '../config.js';

function checkAllowed() {
  if (!workspaceAllowed) {
    throw new Error('Workspace file access is restricted. Grant permission at launch to run Git commands.');
  }
}

export const gitStatus = {
  name: 'git_status',
  description: 'Check status of the current local repository',
  schema: {
    type: 'object',
    properties: {}
  },
  risk: 'safe',
  async execute() {
    try {
      checkAllowed();
      const stdout = execFileSync('git', ['status'], { cwd: process.cwd(), stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const gitPull = {
  name: 'git_pull',
  description: 'Pull updates from the remote repository branch',
  schema: {
    type: 'object',
    properties: {}
  },
  risk: 'safe',
  async execute() {
    try {
      checkAllowed();
      const stdout = execFileSync('git', ['pull'], { cwd: process.cwd(), stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const gitCommit = {
  name: 'git_commit',
  description: 'Commit changes with a commit message. Make sure to stage files first.',
  schema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The commit message' }
    },
    required: ['message']
  },
  risk: 'confirm',
  async execute({ message }) {
    try {
      checkAllowed();
      const stdout = execFileSync('git', ['commit', '-m', message], { cwd: process.cwd(), stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const gitPush = {
  name: 'git_push',
  description: 'Push committed changes to remote repository origin branch',
  schema: {
    type: 'object',
    properties: {}
  },
  risk: 'high',
  async execute() {
    try {
      checkAllowed();
      const stdout = execFileSync('git', ['push'], { cwd: process.cwd(), stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const githubRepoCreate = {
  name: 'github_repo_create',
  description: 'Create a new GitHub repository using gh CLI',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the repository' },
      isPublic: { type: 'boolean', description: 'Whether the repository should be public' }
    },
    required: ['name']
  },
  risk: 'confirm',
  async execute({ name, isPublic = false }) {
    try {
      checkAllowed();
      const visibility = isPublic ? '--public' : '--private';
      const args = ['repo', 'create', name, visibility, '--source=.', '--push'];
      const stdout = execFileSync('gh', args, { cwd: process.cwd(), stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
