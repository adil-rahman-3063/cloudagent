import { execFileSync } from 'child_process';

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
    const args = ['gmail', '+triage', '--max', String(max)];
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

export const gmailRead = {
  name: 'gmail_read',
  description: 'Read the text body and headers of a specific email by ID',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The unique message ID to read' },
      headers: { type: 'boolean', description: 'Include headers (From, To, Subject, Date) in the output' }
    },
    required: ['id']
  },
  risk: 'safe',
  async execute({ id, headers = true }) {
    const args = ['gmail', '+read', '--id', id];
    if (headers) {
      args.push('--headers');
    }
    try {
      const stdout = execFileSync('gws', args, { stdio: 'pipe' }).toString();
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
      const stdout = execFileSync('gws', args, { stdio: 'pipe' }).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
