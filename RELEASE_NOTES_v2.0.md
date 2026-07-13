# Release Notes — CloudAgent v2.0 🌟

We are proud to present **CloudAgent v2.0**! This major release delivers full timezone-aware scheduling, a searchable timezone picker, a manual refresh option, auto-reconnection safety, and copy-message shortcuts.

---

## What's New in v2.0

### 1. 🔍 Searchable Timezone Picker
* Replaced the manual text timezone field in **Settings** with a premium searchable selector dialog.
* Select from common friendly country/city timezone entries (e.g. `Asia/Kolkata`, `America/New_York`, etc.) or search dynamically by typing.
* Automatically defaults to and locks in your system's auto-detected timezone if none is set.

### 2. 📋 One-Click Copyable Messages
* Added an inline Copy button (`Icons.copy_rounded`) right next to every chat message bubble (both user and agent).
* Clicking it copies the raw markdown/text to your clipboard instantly with a success notice.

### 3. 🌐 Timezone-Aware Dates & Local Formatting
* **Boxed Schedule Tables**: Calendar and Tasks overview tables returned in chat results are formatted directly into your selected timezone (no raw `Z` UTC format).
* **Emails & Tasks Widgets**: Homepage dashboard cards now display localized dates next to sender names, and task due dates/times right under task titles.

### 4. 🔄 Manual Dashboard Refresh
* Added a manual **Refresh** action in the welcome header of the dashboard widgets.
* You can now manually query your latest inbox emails, upcoming events, and pending tasks, saving LLM token usage from auto-refreshing.

### 5. ⚡ Automated Reconnect Mechanism
* Added automatic socket retry capability. If the WebSocket server drops or encounters errors, the client will auto-reconnect every 2 seconds up to 5 times.
* The retry counters are automatically reset once connection status succeeds.

---

## Installation & Deployment
The Windows binary executable has been compiled successfully. You can launch it from:
`cloudagent_flutter/build/windows/x64/runner/Release/cloudagent_flutter.exe`
