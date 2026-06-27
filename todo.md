# CloudAgent Integration Test Checklist

This file tracks the testing status of all CloudAgent capabilities.

- [x] **Email Integration (Gmail)**
  - [x] Send email with recipient, subject, and body (direct command & AI draft).
  - [x] Parameter validation (preventing empty subject/body executions).
  - [x] Multiline body formatting (escaped newlines parsed correctly on Windows without truncation).
  - [x] Apostrophe command parsing (e.g., words like `you're` and `I'm` inside double-quoted parameters).
  - [x] List unread inbox summaries.
  - [x] Read specific email threads by ID.
  - [x] Modify email labels / mark as read (`gmail_modify_labels`).

- [x] **Google Tasks**
  - [x] List tasks from the default or specific list (formatted in boxed tables).
  - [x] Create tasks with titles, notes, and due dates.
  - [x] Dynamic tool name normalization (`google_tasks_list` -> `tasks_list`).
  - [x] Update and complete tasks (`tasks_update`).

- [x] **Google Calendar**
  - [x] List agenda and upcoming schedule events.
  - [x] Create calendar events with summaries, times, and Meet links.

- [ ] **Google Drive**
  - [ ] Search files and directories by query parameters.
  - [ ] Download files to local directories.
  - [ ] Upload local files to Drive.

- [x] **System Diagnostics & Configurations**
  - [x] doctor check (Node, Internet, API keys, gws installation, git, sqlite status).
  - [x] Onboarding missing dependencies checking.
  - [x] SQLite database schema initialization and chat session logging.

- [ ] **Local Filesystem**
  - [x] Workspace access approval check on startup.
  - [x] Restricted mode handling (when workspace permission is denied).
  - [x] Change directory and navigate folders (`file_cd`).
  - [x] List files in current directory.
  - [ ] Read local file contents.
  - [ ] Create/Write to local files.
  - [ ] Delete local files.

- [x] **Git & GitHub**
  - [x] Local git repository initialization.
  - [x] Committing code changes.
  - [x] Remote origin linking.
  - [x] Pushing commits to GitHub.
  - [x] Git commands (e.g. `git_status`, `git_pull`) triggered via natural language prompts.

- [ ] **Future Roadmap (Additional gws Services)**
  - [ ] **Google Sheets**: Read, write, and append spreadsheet tables.
  - [ ] **Google Keep**: Manage and sync Keep notes.
  - [ ] **Google Docs**: Read and write Google Document files.
  - [ ] **Google People**: Retrieve and search contacts.

