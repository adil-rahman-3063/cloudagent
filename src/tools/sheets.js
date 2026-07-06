import { execGws } from '../config.js';

async function resolveSpreadsheetId(spreadsheet) {
  if (/^[a-zA-Z0-9-_]{25,50}$/.test(spreadsheet)) {
    return spreadsheet;
  }
  // Try resolving by name using drive.files.list
  const q = `mimeType = 'application/vnd.google-apps.spreadsheet' and name = '${spreadsheet}'`;
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
    // ignore lookup errors
  }
  throw new Error(`Could not resolve spreadsheet with name or ID: "${spreadsheet}"`);
}

export const sheetsRead = {
  name: 'sheets_read',
  description: 'Read cell values from a specified Google Sheets spreadsheet range',
  schema: {
    type: 'object',
    properties: {
      spreadsheet: { type: 'string', description: 'The spreadsheet name or spreadsheet ID' },
      range: { type: 'string', description: 'The A1 notation range to read (e.g. "Sheet1!A1:B10" or just "Sheet1")' }
    },
    required: ['spreadsheet', 'range']
  },
  risk: 'safe',
  async execute({ spreadsheet, range }) {
    try {
      const spreadsheetId = await resolveSpreadsheetId(spreadsheet);
      const args = [
        'sheets',
        '+read',
        '--spreadsheet',
        spreadsheetId,
        '--range',
        range,
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

export const sheetsAppend = {
  name: 'sheets_append',
  description: 'Append one or more rows of values to the end of a Google Sheets spreadsheet',
  schema: {
    type: 'object',
    properties: {
      spreadsheet: { type: 'string', description: 'The spreadsheet name or spreadsheet ID' },
      values: {
        type: 'array',
        description: 'An array of rows (each row is an array of cell values) to append',
        items: { type: 'array' }
      }
    },
    required: ['spreadsheet', 'values']
  },
  risk: 'confirm',
  async execute({ spreadsheet, values }) {
    try {
      const spreadsheetId = await resolveSpreadsheetId(spreadsheet);
      const args = [
        'sheets',
        '+append',
        '--spreadsheet',
        spreadsheetId,
        '--json-values',
        JSON.stringify(values),
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

export const sheetsUpdate = {
  name: 'sheets_update',
  description: 'Set cell values in a specified Google Sheets range',
  schema: {
    type: 'object',
    properties: {
      spreadsheet: { type: 'string', description: 'The spreadsheet name or spreadsheet ID' },
      range: { type: 'string', description: 'The target A1 notation range to update (e.g. "Sheet1!A1:B2")' },
      values: {
        type: 'array',
        description: 'An array of rows (each row is an array of cell values) to write',
        items: { type: 'array' }
      }
    },
    required: ['spreadsheet', 'range', 'values']
  },
  risk: 'confirm',
  async execute({ spreadsheet, range, values }) {
    try {
      const spreadsheetId = await resolveSpreadsheetId(spreadsheet);
      const params = {
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED'
      };
      const body = {
        values,
        majorDimension: 'ROWS'
      };
      const args = [
        'sheets',
        'spreadsheets',
        'values',
        'update',
        '--params',
        JSON.stringify(params),
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

export const sheetsCreate = {
  name: 'sheets_create',
  description: 'Create a new Google Sheets spreadsheet with a specified title',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The title of the new spreadsheet' }
    },
    required: ['title']
  },
  risk: 'confirm',
  async execute({ title }) {
    try {
      const body = {
        properties: {
          title
        }
      };
      const args = [
        'sheets',
        'spreadsheets',
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

