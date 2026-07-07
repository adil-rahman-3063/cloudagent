import { execGws } from '../config.js';

async function resolveDocumentId(documentNameOrId) {
  if (/^[a-zA-Z0-9-_]{25,50}$/.test(documentNameOrId)) {
    return documentNameOrId;
  }
  const q = `mimeType = 'application/vnd.google-apps.document' and name = '${documentNameOrId}' and trashed = false`;
  const lookupArgs = [
    'drive',
    'files',
    'list',
    '--params',
    JSON.stringify({ q }),
    '--format',
    'json'
  ];
  try {
    const stdout = (await execGws(lookupArgs)).toString();
    const data = JSON.parse(stdout);
    const files = data.files || [];
    if (files.length > 0) {
      return files[0].id;
    }
  } catch (e) {
    // ignore
  }
  throw new Error(`Could not resolve document with name or ID: "${documentNameOrId}"`);
}

export function extractTextFromDoc(docData) {
  const content = docData.body?.content || [];
  let text = '';
  for (const element of content) {
    if (element.paragraph) {
      for (const run of element.paragraph.elements) {
        if (run.textRun) {
          text += run.textRun.content;
        }
      }
    }
  }
  return text;
}

export const docsRead = {
  name: 'docs_read',
  description: 'Read the plain text content of a specified Google Docs document',
  schema: {
    type: 'object',
    properties: {
      document: { type: 'string', description: 'The Google Document name or ID' }
    },
    required: ['document']
  },
  risk: 'safe',
  async execute({ document }) {
    try {
      const documentId = await resolveDocumentId(document);
      const args = [
        'docs',
        'documents',
        'get',
        '--params',
        JSON.stringify({ documentId }),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      const docData = JSON.parse(stdout);
      const text = extractTextFromDoc(docData);
      return { success: true, output: JSON.stringify({ title: docData.title, content: text }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const docsWrite = {
  name: 'docs_write',
  description: 'Append text content to the end of a specified Google Docs document',
  schema: {
    type: 'object',
    properties: {
      document: { type: 'string', description: 'The Google Document name or ID' },
      text: { type: 'string', description: 'The plain text content to append' }
    },
    required: ['document', 'text']
  },
  risk: 'confirm',
  async execute({ document, text }) {
    try {
      const documentId = await resolveDocumentId(document);
      const args = [
        'docs',
        '+write',
        '--document',
        documentId,
        '--text',
        text,
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const docsCreate = {
  name: 'docs_create',
  description: 'Create a new Google Docs document with a specified title',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The title of the new document' }
    },
    required: ['title']
  },
  risk: 'confirm',
  async execute({ title }) {
    try {
      const body = {
        title
      };
      const args = [
        'docs',
        'documents',
        'create',
        '--json',
        JSON.stringify(body),
        '--format',
        'json'
      ];
      const stdout = (await execGws(args)).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

export const docsDelete = {
  name: 'docs_delete',
  description: 'Permanently delete a specified Google Docs document by name or ID',
  schema: {
    type: 'object',
    properties: {
      document: { type: 'string', description: 'The Google Document name or ID to delete' }
    },
    required: ['document']
  },
  risk: 'high',
  async execute({ document }) {
    try {
      const documentId = await resolveDocumentId(document);
      const args = [
        'drive',
        'files',
        'delete',
        '--params',
        JSON.stringify({ fileId: documentId }),
        '--format',
        'json'
      ];
      await execGws(args);
      return { success: true, output: `Successfully deleted Google Doc "${document}".` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
