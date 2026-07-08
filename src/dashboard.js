import { execGws } from './config.js';

export async function getDashboardData() {
  const result = {
    emails: [],
    events: [],
    tasks: []
  };

  // 1. Fetch unread emails
  try {
    const stdout = await execGws(['gmail', '+triage', '--max', '5', '--format', 'json']);
    const data = JSON.parse(stdout.toString());
    result.emails = data.messages || [];
    result.emails.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  } catch (e) {
    console.error('Dashboard Error loading emails:', e.message);
  }

  // 2. Fetch upcoming calendar events
  try {
    const stdout = await execGws(['calendar', '+agenda', '--days', '3', '--format', 'json']);
    const data = JSON.parse(stdout.toString());
    result.events = data.items || data.events || [];
    result.events.sort((a, b) => new Date(a.start || 0) - new Date(b.start || 0));
  } catch (e) {
    console.error('Dashboard Error loading calendar events:', e.message);
  }

  // 3. Fetch active tasks
  try {
    const params = { tasklist: '@default', showCompleted: false };
    const stdout = await execGws([
      'tasks',
      'tasks',
      'list',
      '--params',
      JSON.stringify(params),
      '--format',
      'json'
    ]);
    const data = JSON.parse(stdout.toString());
    result.tasks = data.items || [];
    result.tasks.sort((a, b) => {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return new Date(a.due) - new Date(b.due);
    });
  } catch (e) {
    console.error('Dashboard Error loading tasks:', e.message);
  }

  return result;
}
