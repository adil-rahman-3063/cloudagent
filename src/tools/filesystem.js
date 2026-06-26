import fs from 'fs';
import path from 'path';
import { workspaceAllowed } from '../config.js';

function checkAllowed() {
  if (!workspaceAllowed) {
    throw new Error('Workspace file access is restricted. Grant permission at launch to use filesystem tools.');
  }
}

export const fileList = {
  name: 'file_list',
  description: 'List files and directories in the current folder',
  schema: {
    type: 'object',
    properties: {
      dirPath: { type: 'string', description: 'Relative path to list (default current directory)' }
    }
  },
  risk: 'safe',
  async execute({ dirPath = '.' }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(dirPath);
      const files = fs.readdirSync(resolvedPath);
      const output = files.map(file => {
        const stats = fs.statSync(path.join(resolvedPath, file));
        return `${stats.isDirectory() ? '[DIR] ' : '      '}${file}`;
      }).join('\n');
      return { success: true, output: output || '(empty directory)' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const fileRead = {
  name: 'file_read',
  description: 'Read the contents of a local file',
  schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file to read' }
    },
    required: ['filePath']
  },
  risk: 'safe',
  async execute({ filePath }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(filePath);
      const content = fs.readFileSync(resolvedPath, 'utf8');
      return { success: true, output: content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const fileWrite = {
  name: 'file_write',
  description: 'Write content to a file, overwriting if it exists',
  schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'The text content to write' }
    },
    required: ['filePath', 'content']
  },
  risk: 'confirm',
  async execute({ filePath, content }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(filePath);
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return { success: true, output: `Successfully wrote file to ${filePath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const fileDelete = {
  name: 'file_delete',
  description: 'Delete a local file',
  schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to the file to delete' }
    },
    required: ['filePath']
  },
  risk: 'high',
  async execute({ filePath }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(filePath);
      fs.unlinkSync(resolvedPath);
      return { success: true, output: `Successfully deleted file ${filePath}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const fileCd = {
  name: 'file_cd',
  description: 'Change the current working directory to navigate to other folders or projects',
  schema: {
    type: 'object',
    properties: {
      dirPath: { type: 'string', description: 'Path to the target directory (absolute or relative)' }
    },
    required: ['dirPath']
  },
  risk: 'safe',
  async execute({ dirPath }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(dirPath);
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `Directory does not exist: ${dirPath}` };
      }
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${dirPath}` };
      }
      process.chdir(resolvedPath);
      return { success: true, output: `Changed working directory to: ${process.cwd()}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
