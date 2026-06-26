import { execGws } from '../config.js';
import { tryFormatGmail } from '../formatter.js';

export const gmailList = {
  name: 'gmail_list',
  description: 'List unread inbox summary or search emails using a query',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query (e.g. "from:boss" or "is:unread")' },
      max: { type: 'number', description: 'Maximum messages to show (default: 20)' }
    }
  },
  risk: 'safe',
  async execute({ query, max = 20 }) {
    const args = ['gmail', '+triage', '--max', String(max), '--format', 'json'];
    if (query) {
      args.push('--query', query);
    }
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: tryFormatGmail(stdout) };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const gmailRead = {
  name: 'gmail_read',
  description: 'Read the text body and headers of a specific email by ID or search query (e.g. sender email address)',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The unique message ID to read, or sender/recipient email address or search query' },
      headers: { type: 'boolean', description: 'Include headers (From, To, Subject, Date) in the output' }
    },
    required: ['id']
  },
  risk: 'safe',
  async execute({ id, headers = true }) {
    let targetId = id;
    if (id && (!/^[a-f0-9]{16}$/i.test(id))) {
      // If it's not a 16-character hex ID, search for messages using the query
      const searchArgs = ['gmail', '+triage', '--query', id, '--max', '1', '--format', 'json'];
      try {
        const stdout = execGws(searchArgs).toString();
        const data = JSON.parse(stdout);
        const messages = data.messages || [];
        if (messages.length > 0) {
          targetId = messages[0].id;
        } else {
          return { success: false, error: `No emails found matching "${id}"` };
        }
      } catch (error) {
        return { success: false, error: `Failed to resolve email ID for "${id}": ` + (error.stderr?.toString() || error.message) };
      }
    }
    const args = ['gmail', '+read', '--id', targetId];
    if (headers) {
      args.push('--headers');
    }
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const gmailSend = {
  name: 'gmail_send',
  description: 'Send a new email message',
  schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Email address of the recipient' },
      subject: { type: 'string', description: 'Subject of the email' },
      body: { type: 'string', description: 'Body text of the email' }
    },
    required: ['to', 'subject', 'body']
  },
  risk: 'confirm',
  async execute({ to, subject, body }) {
    const args = ['gmail', '+send', '--to', to, '--subject', subject, '--body', body];
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
