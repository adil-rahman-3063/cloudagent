import path from 'path';
import fs from 'fs';
import { workspaceAllowed, execGws } from '../config.js';
import { tryFormatDrive } from '../formatter.js';

function checkAllowed() {
  if (!workspaceAllowed) {
    throw new Error('Workspace file access is restricted. Grant permission at launch to upload local files.');
  }
}

export const driveSearch = {
  name: 'drive_search',
  description: 'Search for files or folders in Google Drive, or list files inside a specific folder',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional search term or query (e.g. "my-doc" or structured like "mimeType = \'image/jpeg\'")' },
      folder: { type: 'string', description: 'Optional folder name or folder ID to list files inside it' }
    }
  },
  risk: 'safe',
  async execute({ query, folder }) {
    const params = {};
    
    // Resolve folder ID if folder name/ID is provided
    let folderId = null;
    if (folder) {
      if (/^[a-zA-Z0-9-_]{25,50}$/.test(folder)) {
        folderId = folder;
      } else {
        // Resolve folder name to ID
        const folderLookupParams = {
          q: `mimeType = 'application/vnd.google-apps.folder' and name = '${folder}'`
        };
        const lookupArgs = [
          'drive',
          'files',
          'list',
          '--params',
          JSON.stringify(folderLookupParams),
          '--format',
          'json'
        ];
        try {
          const stdout = (await execGws(lookupArgs)).toString();
          const data = JSON.parse(stdout);
          const files = data.files || [];
          if (files.length > 0) {
            folderId = files[0].id;
          }
        } catch (e) {
          // ignore lookup errors
        }
      }
    }

    let q = '';
    if (folderId) {
      q = `'${folderId}' in parents`;
    }
    
    if (query) {
      let termQ = '';
      if (query.includes('=') || query.includes('contains')) {
        termQ = query;
      } else {
        termQ = `name contains '${query}'`;
      }
      q = q ? `${q} and ${termQ}` : termQ;
    }
    
    if (q) {
      params.q = q;
    }
    
    const args = [
      'drive',
      'files',
      'list',
      '--params',
      JSON.stringify(params),
      '--format',
      'json'
    ];
    try {
      const stdout = (await execGws(args)).toString();
      return { success: true, output: tryFormatDrive(stdout) };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const driveDownload = {
  name: 'drive_download',
  description: 'Download a file from Google Drive by its File ID or name',
  schema: {
    type: 'object',
    properties: {
      fileId: { type: 'string', description: 'The unique ID or filename of the file to download' },
      destination: { type: 'string', description: 'Optional local destination path' }
    },
    required: ['fileId']
  },
  risk: 'safe',
  async execute({ fileId, destination }) {
    try {
      if (destination) checkAllowed();
      let targetId = fileId;
      let filename = fileId;

      // Resolve name to ID if it doesn't look like a standard Drive ID
      if (fileId && (fileId.includes('.') || fileId.includes(' ') || fileId.length < 25)) {
        const params = { q: `name = '${fileId}'` };
        const listArgs = [
          'drive',
          'files',
          'list',
          '--params',
          JSON.stringify(params),
          '--format',
          'json'
        ];
        try {
          const stdout = (await execGws(listArgs)).toString();
          const data = JSON.parse(stdout);
          const files = data.files || [];
          if (files.length > 0) {
            targetId = files[0].id;
            filename = files[0].name;
          }
        } catch (e) {
          // ignore lookup errors
        }
      } else {
        // Query filename for standard ID
        const params = { q: `id = '${fileId}'` };
        const listArgs = [
          'drive',
          'files',
          'list',
          '--params',
          JSON.stringify(params),
          '--format',
          'json'
        ];
        try {
          const stdout = (await execGws(listArgs)).toString();
          const data = JSON.parse(stdout);
          const files = data.files || [];
          if (files.length > 0) {
            filename = files[0].name;
          }
        } catch (e) {
          // ignore
        }
      }

      // Check if destination is requested as "downloads"
      let finalDest = destination || '';
      if (finalDest.toLowerCase() === 'downloads' || finalDest.toLowerCase() === 'downloads folder') {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        finalDest = path.join(homeDir, 'Downloads');
      }

      let resolvedPath = '';

      if (finalDest) {
        try {
          if (fs.existsSync(finalDest) && fs.statSync(finalDest).isDirectory()) {
            resolvedPath = path.resolve(path.join(finalDest, filename));
          } else {
            resolvedPath = path.resolve(finalDest);
          }
        } catch (e) {
          resolvedPath = path.resolve(finalDest);
        }
      } else {
        resolvedPath = path.resolve(filename);
      }

      // Ensure target parent directory exists before downloading
      const parentDir = path.dirname(resolvedPath);
      try {
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      } catch (e) {
        // ignore
      }

      const basename = path.basename(resolvedPath);

      const args = [
        'drive',
        'files',
        'get',
        '--params',
        JSON.stringify({ fileId: targetId, alt: 'media' }),
        '--output',
        basename
      ];

      const stdout = (await execGws(args, { cwd: parentDir })).toString();
      return { 
        success: true, 
        output: `${stdout.trim()}\n\nVerified local download path: ${resolvedPath}`
      };
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
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const driveDelete = {
  name: 'drive_delete',
  description: 'Permanently delete a file or folder from Google Drive by name or ID',
  schema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The file/folder name or Google Drive file ID to delete' }
    },
    required: ['file']
  },
  risk: 'high',
  async execute({ file }) {
    try {
      let fileId = file;
      if (!/^[a-zA-Z0-9-_]{25,50}$/.test(file)) {
        // Resolve by name
        const q = `name = '${file}' and trashed = false`;
        const lookupArgs = [
          'drive',
          'files',
          'list',
          '--params',
          JSON.stringify({ q }),
          '--format',
          'json'
        ];
        const stdout = (await execGws(lookupArgs)).toString();
        const data = JSON.parse(stdout);
        const files = data.files || [];
        if (files.length === 0) {
          throw new Error(`File or folder not found: "${file}"`);
        }
        fileId = files[0].id;
      }
      
      const args = [
        'drive',
        'files',
        'delete',
        '--params',
        JSON.stringify({ fileId }),
        '--format',
        'json'
      ];
      await execGws(args);
      return { success: true, output: `Successfully deleted file/folder "${file}" from Google Drive.` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

