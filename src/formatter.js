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

  const output = [];
  output.push(chalk.bold.yellow(`\n📁  ${title}`));

  for (const row of rows) {
    const itemParts = [];
    for (let i = 0; i < headers.length; i++) {
      const headerName = headers[i];
      let val = String(row[i] || '').trim();
      if (!val) continue;
      
      if (headerName.toLowerCase() === 'id') {
        itemParts.push(`${chalk.dim(headerName)}: ${chalk.dim(val)}`);
      } else if (headerName.toLowerCase() === 'date' || headerName.toLowerCase() === 'time') {
        itemParts.push(`${chalk.bold(headerName)}: ${chalk.green(val)}`);
      } else {
        itemParts.push(`${chalk.bold(headerName)}: ${val}`);
      }
    }
    output.push(`  - ${itemParts.join('  •  ')}`);
  }

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
    if (toolName === 'drive_delete') {
      return chalk.green(`✓ File or folder permanently deleted from Google Drive successfully!`);
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
    if (toolName === 'sheets_create') {
      const name = resObj.properties?.title || 'Untitled Spreadsheet';
      const id = resObj.spreadsheetId || '';
      return chalk.green(`✓ Google Sheet "${name}" created successfully! (ID: ${id})`);
    }
    if (toolName === 'docs_read') {
      return tryFormatDocsRead(stdout);
    }
    if (toolName === 'docs_write') {
      return chalk.green('✓ Text appended to Google Doc successfully!');
    }
    if (toolName === 'docs_create') {
      const title = resObj.title || 'Untitled Document';
      const id = resObj.documentId || '';
      return chalk.green(`✓ Google Doc "${title}" created successfully! (ID: ${id})`);
    }
    if (toolName === 'docs_delete') {
      return chalk.green(stdout);
    }
    if (toolName === 'contacts_list' || toolName === 'contacts_search') {
      return tryFormatContactsList(stdout);
    }
    if (toolName === 'contacts_create') {
      const name = resObj.names?.[0]?.displayName || 'Unnamed Contact';
      return chalk.green(`✓ Google Contact "${name}" created successfully!`);
    }
    if (toolName === 'contacts_update') {
      const name = resObj.names?.[0]?.displayName || 'Unnamed Contact';
      return chalk.green(`✓ Google Contact "${name}" updated successfully!`);
    }
    if (toolName === 'contacts_delete') {
      return chalk.green(stdout);
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

export function tryFormatDocsRead(stdout) {
  try {
    const data = JSON.parse(stdout);
    return `\n${chalk.bold.cyan(`📄 Google Doc: ${data.title || 'Untitled'}`)}\n${chalk.dim('─'.repeat(40))}\n${data.content || chalk.dim('(empty document)')}\n${chalk.dim('─'.repeat(40))}`;
  } catch (e) {
    return stdout;
  }
}

export function tryFormatContactsList(stdout) {
  try {
    const data = JSON.parse(stdout);
    let people = [];
    if (data.connections) {
      people = data.connections;
    } else if (data.results) {
      people = data.results.map(r => r.person);
    }

    if (people.length === 0) {
      return chalk.dim('\n(no contacts found)');
    }

    let output = `\n${chalk.bold.cyan('👥 Google Contacts:')}\n`;
    for (const p of people) {
      const name = p.names?.[0]?.displayName || 'Unnamed';
      const email = p.emailAddresses?.[0]?.value || chalk.dim('N/A');
      const phone = p.phoneNumbers?.[0]?.value || chalk.dim('N/A');
      const resourceName = p.resourceName || '';
      output += `  - ${chalk.bold(name)} | ${email} | ${phone} | ${chalk.dim(resourceName)}\n`;
    }
    return output;
  } catch (e) {
    return stdout;
  }
}

