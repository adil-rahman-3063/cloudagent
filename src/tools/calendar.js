import { execGws } from '../config.js';
import { tryFormatCalendar } from '../formatter.js';

export const calendarList = {
  name: 'calendar_list',
  description: 'List upcoming events across user calendars',
  schema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Number of days ahead to show (default: 7)' },
      today: { type: 'boolean', description: 'Only show today\'s events' },
      week: { type: 'boolean', description: 'Show this week\'s events' }
    }
  },
  risk: 'safe',
  async execute({ days, today, week }) {
    const args = ['calendar', '+agenda', '--format', 'json'];
    if (today) {
      args.push('--today');
    } else if (week) {
      args.push('--week');
    } else if (days) {
      args.push('--days', String(days));
    }
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: tryFormatCalendar(stdout) };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};

export const calendarCreate = {
  name: 'calendar_create',
  description: 'Create a new calendar event',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Title or summary of the event' },
      start: { type: 'string', description: 'Start time (ISO 8601, e.g. 2026-06-24T10:00:00-07:00)' },
      end: { type: 'string', description: 'End time (ISO 8601)' },
      description: { type: 'string', description: 'Optional description of the event' },
      location: { type: 'string', description: 'Optional location' },
      meet: { type: 'boolean', description: 'Add Google Meet link' }
    },
    required: ['title', 'start', 'end']
  },
  risk: 'confirm',
  async execute({ title, start, end, description, location, meet }) {
    const args = [
      'calendar',
      '+insert',
      '--summary',
      title,
      '--start',
      start,
      '--end',
      end
    ];
    if (description) {
      args.push('--description', description);
    }
    if (location) {
      args.push('--location', location);
    }
    if (meet) {
      args.push('--meet');
    }
    try {
      const stdout = execGws(args).toString();
      return { success: true, output: stdout };
    } catch (error) {
      return { success: false, error: error.stderr?.toString() || error.message };
    }
  }
};
