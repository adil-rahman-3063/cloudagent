import fs from 'fs';
import path from 'path';
import os from 'os';
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

export function resolveSmartPath(dirPath) {
  let resolved = path.resolve(dirPath);
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // Try traversing parent directories
  let current = process.cwd();
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) {
      break; // Reached root
    }

    // 1. Try directly relative to parent (e.g. parent/downloads)
    const directTry = path.resolve(parent, dirPath);
    if (fs.existsSync(directTry)) {
      return directTry;
    }

    // 2. Try stripping the parent's folder name from the start of dirPath
    const parentBasename = path.basename(parent).toLowerCase();
    const normalizedPath = dirPath.replace(/\\/g, '/');
    const firstPart = normalizedPath.split('/')[0].toLowerCase();
    if (parentBasename === firstPart) {
      const remaining = normalizedPath.substring(firstPart.length).replace(/^\/+/, '');
      const stripTry = path.resolve(parent, remaining);
      if (fs.existsSync(stripTry)) {
        return stripTry;
      }
    }

    current = parent;
  }

  return resolved;
}

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
  risk: 'confirm',
  async execute({ dirPath }) {
    try {
      checkAllowed();
      const resolvedPath = resolveSmartPath(dirPath);
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

export const fileFindProjects = {
  name: 'file_find_projects',
  description: 'Locate the parent directory containing all project folders/repositories (such as "projects", "src", "workspace", "repos", or the parent of the current project) and list all projects found inside. Use this when the user asks to see their projects, navigate their project folder, or list their workspaces.',
  schema: {
    type: 'object',
    properties: {
      customPath: { type: 'string', description: 'Optional custom path to the projects directory if specified by the user' }
    }
  },
  risk: 'safe',
  async execute({ customPath }) {
    try {
      checkAllowed();
      
      let projectsDir = null;
      if (customPath) {
        const resolved = path.resolve(customPath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          projectsDir = resolved;
        }
      }

      if (!projectsDir) {
        // Try common paths
        const pathsToTry = [
          path.resolve(process.cwd(), '..'), // Parent of current project
          path.join(os.homedir(), 'Documents', 'projects'),
          path.join(os.homedir(), 'projects'),
          path.join(os.homedir(), 'workspace'),
          path.join(os.homedir(), 'repos'),
          path.join(os.homedir(), 'src'),
          path.join(os.homedir(), 'Developer'),
          path.join(os.homedir(), 'code')
        ];

        for (const p of pathsToTry) {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            const base = path.basename(p).toLowerCase();
            const isCommonName = ['projects', 'src', 'workspace', 'repos', 'developer', 'code'].includes(base);
            const isParentDir = p === path.resolve(process.cwd(), '..');
            if (isCommonName || isParentDir) {
              projectsDir = p;
              break;
            }
          }
        }
      }

      if (!projectsDir) {
        return { 
          success: false, 
          error: 'Could not automatically find your projects folder. Please specify the path to your projects directory (e.g., using a custom path).' 
        };
      }

      const files = fs.readdirSync(projectsDir);
      const projectFolders = files.filter(file => {
        const fullPath = path.join(projectsDir, file);
        try {
          return fs.statSync(fullPath).isDirectory() && !file.startsWith('.') && file !== 'node_modules';
        } catch (e) {
          return false;
        }
      });

      return {
        success: true,
        output: JSON.stringify({
          projectsDirectory: projectsDir,
          projects: projectFolders
        }, null, 2)
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
