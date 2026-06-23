import { execFileSync } from 'child_process';
import path from 'path';
import { workspaceAllowed } from '../config.js';

function checkAllowed() {
  if (!workspaceAllowed) {
    throw new Error('Workspace file access is restricted. Grant permission at launch to upload local files.');
  }
}

export const driveSearch = {
  name: 'drive_search',
  description: 'Search for files or folders in Google Drive',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or query' }
    }
  },
  risk: 'safe',
  async execute({ query }) {
    const args = ['drive', 'files', 'list'];
    if (query) {
      args.push('--query', query);
    }
    try {
      const stdout = execFileSync('gws', args, { stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const driveDownload = {
  name: 'drive_download',
  description: 'Download a file from Google Drive by its File ID',
  schema: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The unique ID of the file to download' },
      destination: { type: 'string', description: 'Optional local destination path' }
    },
    required: ['fileId']
  },
  risk: 'safe',
  async execute({ fileId, destination }) {
    try {
      if (destination) checkAllowed();
      const args = ['drive', 'files', 'download', fileId];
      if (destination) {
        args.push('--destination', path.resolve(destination));
      }
      const stdout = execFileSync('gws', args, { stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const driveUpload = {
  name: 'drive_upload',
  description: 'Upload a local file to Google Drive',
  schema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Local path of the file to upload' },
      name: { type: 'string', description: 'Optional target filename in Drive' },
      parent: { type: 'string', description: 'Optional parent folder ID in Drive' }
    },
    required: ['filePath']
  },
  risk: 'confirm',
  async execute({ filePath, name, parent }) {
    try {
      checkAllowed();
      const resolvedPath = path.resolve(filePath);
      const args = ['drive', '+upload', resolvedPath];
      if (name) {
        args.push('--name', name);
      }
      if (parent) {
        args.push('--parent', parent);
      }
      const stdout = execFileSync('gws', args, { stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
