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
export function tryFormatGmailRead(stdout) {
  if (!stdout) return stdout;
  return stdout
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}


export function tryFormatDrive(stdout) {
  try {
    const data = JSON.parse(stdout);
    const filesList = data.files || [];
    
    if (filesList.length === 0) {
      return '(No files or folders found)';
    }

    const folders = [];
    const files = [];

    for (const f of filesList) {
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      if (isFolder) {
        folders.push(f.name);
      } else {
        files.push(f.name);
      }
    }

    // Sort alphabetically (case-insensitive)
    folders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    let output = '';
    if (folders.length > 0) {
      output += '**Folders:**\n' + folders.map(name => `- ${name}`).join('\n') + '\n\n';
    }
    if (files.length > 0) {
      output += '**Files:**\n' + files.map(name => `- ${name}`).join('\n');
    }

    return output.trim();
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
  if (toolName === 'file_read') {
    return stdout;
  }
  try {
    const resObj = JSON.parse(stdout);
    if (toolName === 'gmail_send' && resObj.id) {
      return chalk.green(`✓ Email sent successfully! (ID: ${resObj.id})`);
    }
    if (toolName === 'calendar_create' && resObj.id) {
      return chalk.green(`✓ Calendar event created successfully! (ID: ${resObj.id})`);
    }
    if (toolName === 'tasks_create' && resObj.id) {
      return chalk.green(`✓ Task created successfully! (ID: ${resObj.id})`);
    }
    if (toolName === 'tasks_update' && resObj.id) {
      return chalk.green(`✓ Task updated successfully! (Title: "${resObj.title || ''}")`);
    }
    if (toolName === 'drive_upload' && resObj.id) {
      return chalk.green(`✓ File uploaded successfully! (File: "${resObj.name || ''}", ID: ${resObj.id || ''})`);
    }
    if (toolName === 'gmail_modify_labels') {
      return chalk.green(`✓ Email labels updated successfully!`);
    }
    if (toolName === 'file_list') {
      const { directories = [], files = [] } = resObj;
      let output = '';
      if (directories.length > 0) {
        output += `\n${chalk.bold.cyan('📂 Directories:')}\n` + directories.map(d => `  - ${d}`).join('\n') + '\n';
      }
      if (files.length > 0) {
        output += `\n${chalk.bold.green('📄 Files:')}\n` + files.map(f => `  - ${f}`).join('\n') + '\n';
      }
      if (!output) {
        return chalk.dim('\n(empty directory)');
      }
      return output;
    }
    if (toolName === 'sheets_read') {
      return tryFormatSheetsRead(stdout);
    }
    if (toolName === 'sheets_append') {
      return chalk.green('✓ Row appended to Google Sheet successfully!');
    }
    if (toolName === 'sheets_update') {
      return chalk.green('✓ Google Sheet cell values updated successfully!');
    }

    // Universal JSON Formatter Fallback
    if (resObj && typeof resObj === 'object') {
      if (Array.isArray(resObj)) {
        return resObj.map(item => {
          if (typeof item === 'object') {
            return Object.entries(item).map(([k, v]) => `  - ${chalk.bold(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
          }
          return `  - ${item}`;
        }).join('\n\n');
      } else {
        const lines = [];
        for (const [key, value] of Object.entries(resObj)) {
          if (value !== null && value !== undefined) {
            if (typeof value === 'object') {
              lines.push(`  - ${chalk.bold(key)}: ${JSON.stringify(value)}`);
            } else {
              lines.push(`  - ${chalk.bold(key)}: ${value}`);
            }
          }
        }
        if (lines.length > 0) {
          return lines.join('\n');
        }
      }
    }

    return stdout;
  } catch (e) {
    return stdout;
  }
}

export function tryFormatSheetsRead(stdout) {
  try {
    const data = JSON.parse(stdout);
    const values = data.values || [];
    if (values.length === 0) {
      return chalk.yellow(`\n📦 Sheets Values\n(No cell values found in range)`);
    }
    
    const maxCols = Math.max(...values.map(r => r.length));
    const headers = [];
    for (let i = 0; i < maxCols; i++) {
      headers.push(String.fromCharCode(65 + i)); 
    }
    
    const rows = values.map(r => {
      const rowCells = [];
      for (let i = 0; i < maxCols; i++) {
        rowCells.push(r[i] !== undefined ? String(r[i]) : '');
      }
      return rowCells;
    });

    return formatBoxedTable(`Google Sheets Range: ${data.range || ''}`, headers, rows);
  } catch (e) {
    return stdout;
  }
}

