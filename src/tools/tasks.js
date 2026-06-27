import { execGws } from '../config.js';
import { tryFormatTasks } from '../formatter.js';

export const tasksList = {
  name: 'tasks_list',
  description: 'List Google Tasks from a specific tasklist (defaults to default task list)',
  schema: {
    type: 'object',
    properties: {
      tasklist: { type: 'string', description: 'Tasklist ID or name (defaults to "@default")' },
      showCompleted: { type: 'boolean', description: 'Show completed tasks' }
    }
  },
  risk: 'safe',
  async execute({ tasklist, showCompleted }) {
    const listId = tasklist || '@default';
    const params = { tasklist: listId };
    if (showCompleted !== undefined) {
      params.showCompleted = showCompleted;
    }
    
    const args = [
      'tasks',
      'tasks',
      'list',
      '--params',
      JSON.stringify(params),
      '--format',
      'json'
    ];
    
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: tryFormatTasks(stdout) };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const tasksCreate = {
  name: 'tasks_create',
  description: 'Create a new Google Task',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title or summary of the task' },
      notes: { type: 'string', description: 'Detailed notes/description' },
      due: { type: 'string', description: 'Due date (RFC3339 format, e.g. 2026-06-28T00:00:00Z)' },
      tasklist: { type: 'string', description: 'Tasklist ID (defaults to "@default")' }
    },
    required: ['title']
  },
  risk: 'confirm',
  async execute({ title, notes, due, tasklist }) {
    const listId = tasklist || '@default';
    const body = { title };
    if (notes) body.notes = notes;
    if (due) body.due = due;

    const args = [
      'tasks',
      'tasks',
      'insert',
      '--params',
      JSON.stringify({ tasklist: listId }),
      '--json',
      JSON.stringify(body),
      '--format',
      'json'
    ];

    try {
      const stdout = execGws(args).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const tasksUpdate = {
  name: 'tasks_update',
  description: 'Update an existing Google Task (e.g., mark as completed, rename, change due date) by ID or title/name',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The unique ID of the task to update, or its title/name (e.g. "test", "get haircut"). If the unique ID is not known, you MUST pass the title/name of the task as this argument.' },
      tasklist: { type: 'string', description: 'Tasklist ID (defaults to "@default")' },
      status: { type: 'string', description: 'Status of the task ("completed" or "needsAction")' },
      title: { type: 'string', description: 'Updated title or summary of the task' },
      notes: { type: 'string', description: 'Updated detailed notes/description' },
      due: { type: 'string', description: 'Updated due date (RFC3339 format, e.g. 2026-06-28T00:00:00Z)' }
    },
    required: ['id']
  },
  risk: 'confirm',
  async execute({ id, tasklist, status, title, notes, due }) {
    const listId = tasklist || '@default';
    let targetId = id;

    // List tasks to try to find one matching by title/name
    try {
      const listParams = { tasklist: listId };
      const listArgs = [
        'tasks',
        'tasks',
        'list',
        '--params',
        JSON.stringify(listParams),
        '--format',
        'json'
      ];
      const listStdout = execGws(listArgs).toString();
      const listData = JSON.parse(listStdout);
      const items = listData.items || [];
      
      const matchedTask = items.find(t => t.title && t.title.toLowerCase().trim() === id.toLowerCase().trim());
      if (matchedTask) {
        targetId = matchedTask.id;
      }
    } catch (e) {
      // ignore list errors and use id as-is
    }

    const body = { id: targetId };
    if (status) body.status = status;
    if (title) body.title = title;
    if (notes) body.notes = notes;
    if (due) body.due = due;

    const args = [
      'tasks',
      'tasks',
      'update',
      '--params',
      JSON.stringify({ tasklist: listId, task: targetId }),
      '--json',
      JSON.stringify(body),
      '--format',
      'json'
    ];

    try {
      const stdout = execGws(args).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
