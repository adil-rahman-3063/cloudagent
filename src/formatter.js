import chalk from 'chalk';

function truncate(str, max = 40) {
  if (!str) return '';
  const cleanStr = String(str).replace(/[\r\n]+/g, ' ');
  return cleanStr.length > max ? cleanStr.substring(0, max - 3) + '...' : cleanStr;
}

export function formatBoxedTable(title, headers, rows) {
  if (rows.length === 0) {
    return chalk.yellow(`\n📦 ${title}\n(No records found)`);
  }

  // Calculate column widths based on longest values
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      const val = String(r[i] || '');
      if (val.length > max) max = val.length;
    }
    return max;
  });

  const topBorder = chalk.blue('┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');
  const headerLine = chalk.blue('│') + headers.map((h, i) => ' ' + chalk.bold.cyan(h.padEnd(colWidths[i])) + ' ').join(chalk.blue('│')) + chalk.blue('│');
  const dividerLine = chalk.blue('├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤');
  const bottomBorder = chalk.blue('└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');

  const output = [];
  output.push(chalk.bold.yellow(`\n📁  ${title}`));
  output.push(topBorder);
  output.push(headerLine);
  output.push(dividerLine);

  for (const row of rows) {
    const formattedRow = ' ' + row.map((cell, i) => {
      const text = String(cell || '').padEnd(colWidths[i]);
      // Apply different colors based on header type
      if (headers[i].toLowerCase() === 'id') return chalk.dim(text);
      if (headers[i].toLowerCase() === 'date' || headers[i].toLowerCase() === 'time') return chalk.green(text);
      return text;
    }).join(' ' + chalk.blue('│') + ' ');
    
    output.push(chalk.blue('│') + formattedRow + ' ' + chalk.blue('│'));
  }

  output.push(bottomBorder);
  return output.join('\n');
}

export function tryFormatGmail(stdout) {
  try {
    const data = JSON.parse(stdout);
    const messages = data.messages || [];
    const headers = ['Date', 'From', 'Subject', 'ID'];
    const rows = messages.map(m => [
      truncate(m.date, 25),
      truncate(m.from, 30),
      truncate(m.subject, 35),
      m.id || ''
    ]);
    return formatBoxedTable('Gmail Messages Inbox', headers, rows);
  } catch (e) {
    return stdout;
  }
}

export function tryFormatDrive(stdout) {
  try {
    const data = JSON.parse(stdout);
    const files = data.files || [];
    const headers = ['Name', 'MimeType', 'ID'];
    const rows = files.map(f => [
      truncate(f.name, 35),
      truncate(f.mimeType, 25),
      f.id || ''
    ]);
    return formatBoxedTable('Google Drive Files', headers, rows);
  } catch (e) {
    return stdout;
  }
}

export function tryFormatCalendar(stdout) {
  try {
    const data = JSON.parse(stdout);
    const events = data.events || [];
    const headers = ['Time', 'Calendar', 'Summary'];
    const rows = events.map(e => [
      truncate(e.start, 25),
      truncate(e.calendar, 20),
      truncate(e.summary, 35)
    ]);
    return formatBoxedTable('Upcoming Calendar Schedule', headers, rows);
  } catch (e) {
    return stdout;
  }
}

export function tryFormatTasks(stdout) {
  try {
    const data = JSON.parse(stdout);
    const items = data.items || [];
    const headers = ['Due Date', 'Title', 'Status', 'ID'];
    const rows = items.map(t => [
      truncate(t.due ? t.due.split('T')[0] : 'No Due Date', 15),
      truncate(t.title, 40),
      truncate(t.status, 15),
      t.id || ''
    ]);
    return formatBoxedTable('Google Tasks List', headers, rows);
  } catch (e) {
    return stdout;
  }
}

export function tryFormatSuccess(toolName, stdout) {
  try {
    const resObj = JSON.parse(stdout);
    if (toolName === 'gmail_send' && resObj.id) {
      return chalk.green(`\n✓ Email sent successfully! (ID: ${resObj.id})`);
    }
    if (toolName === 'calendar_create' && resObj.id) {
      return chalk.green(`\n✓ Calendar event created successfully! (ID: ${resObj.id})`);
    }
    if (toolName === 'tasks_create' && resObj.id) {
      return chalk.green(`\n✓ Task created successfully! (ID: ${resObj.id})`);
    }
    return stdout;
  } catch (e) {
    return stdout;
  }
}
