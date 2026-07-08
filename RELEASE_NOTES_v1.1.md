# Release Notes — CloudAgent v1.1 🚀

We are excited to announce the release of **CloudAgent v1.1**! This version introduces multiple advanced workspace tools, UI enhancements, real-time logging, timezone safety, and performance optimizations.

---

## What's New in v1.1

### 1. ⚙️ Real-time log output stream (Collapsible Tool Logs)
* Added a live logging stream inside tool run bubbles. You can now see output from CLI commands (such as keyring activations or request details) as they execute.
* Logs are automatically expanded when running and auto-collapse once the task finishes.

### 2. 🤖 AI Chat Auto-Renaming
* The pen/edit button next to conversations in the sidebar now triggers an automatic rename of the chat based on its content using the active LLM.

### 3. 🌐 Timezone-Aware Dates & UTC Offset Calculation
* Injected explicit timezone regions (e.g. `Asia/Kolkata`) and offset parameters into prompt contexts.
* The LLM now calculates exact UTC/Zulu (`Z`) times correctly relative to your local relative inputs (e.g. "tomorrow at 9:00 AM" converts perfectly to the correct UTC string).

### 4. 🛑 Non-blocking WebSocket Confirmations
* Replaced interactive terminal input blocks with non-blocking WebSocket callbacks. 
* High-risk actions (like creating/deleting files or tasks) now pause correctly and prompt you inline with **Approve** or **Reject** buttons in the app.

### 5. 📁 Sorted Workspace Dashboard & History Tables
* Inbox emails, calendar events, and tasks lists are sorted programmatically by date/due-date (ascending or descending) across both widgets and chat summaries.

### 6. 🏠 Workspace Shortcuts
* Added a **Home** shortcut in the header to easily navigate back to the Google Workspace status dashboard.

### 7. ⚡ Concurrent Chat Session Management
* Multi-session map updates allow background tasks to run independently in different chats without losing state or bleeding outputs across sessions.

---

## Installation & Deployment
The fresh Windows runner build has been compiled successfully. You can find the executable at:
`cloudagent_flutter/build/windows/x64/runner/Release/cloudagent_flutter.exe`
