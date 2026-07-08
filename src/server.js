import { WebSocketServer } from 'ws';
import { runAgentStepJSON, getHelpText, activeRuns } from './cli.js';
import { 
  initDatabase, 
  createSession, 
  saveMessage, 
  getSessionMessages, 
  getLastSession, 
  getSessions, 
  deleteSession, 
  updateSessionName 
} from './db.js';
import { readConfig, writeConfig } from './config.js';
import { tryFormatSuccess } from './formatter.js';
import { getDiagnosticsStatus } from './doctor.js';
import { getDashboardData } from './dashboard.js';
import { getActiveProvider } from './agent.js';
import { execSync } from 'child_process';

const PORT = process.env.PORT || 3020;

const activeSockets = new Map();

global.wsConfirmHandler = (sId, toolName, args, risk) => {
  const ws = activeSockets.get(sId);
  if (!ws) return Promise.resolve(false);

  ws.send(JSON.stringify({
    type: 'confirm',
    sessionId: sId,
    tool: toolName,
    arguments: args,
    risk: risk
  }));

  return new Promise((resolve) => {
    if (!global.pendingConfirmResolvers) {
      global.pendingConfirmResolvers = new Map();
    }
    global.pendingConfirmResolvers.set(sId, resolve);
  });
};

export function startServer() {
  initDatabase();
  
  const wss = new WebSocketServer({ port: PORT });
  console.log(`🚀 CloudAgent Backend Server running on ws://localhost:${PORT}`);

  wss.on('connection', (ws) => {
    console.log('🔌 Client connected');

    // Get current GWS user details
    let gwsUserEmail = '';
    try {
      const statusOutput = execSync('gws auth status', { stdio: 'pipe' }).toString();
      const statusObj = JSON.parse(statusOutput);
      if (statusObj && (statusObj.token_valid === true || statusObj.status === 'success')) {
        gwsUserEmail = statusObj.user || statusObj.account || '';
      }
    } catch (e) {
      // ignore
    }

    // Get last session or start fresh
    const lastSession = getLastSession();
    let sessionId = lastSession ? lastSession.id : 'session_' + Date.now();
    const currentSessions = getSessions();
    if (currentSessions.length === 0) {
      createSession(sessionId);
      currentSessions.push({ id: sessionId, name: 'New Chat', updated_at: new Date().toISOString() });
    }

    // Map active sockets
    activeSockets.set(sessionId, ws);
    currentSessions.forEach(s => activeSockets.set(s.id, ws));

    // Get active provider & model from config
    const config = readConfig();
    const activeModel = config.active_model || 'google/gemini-2.5-flash';

    // Send initial session packet
    ws.send(JSON.stringify({
      type: 'session',
      sessionId,
      workspace: process.cwd(),
      gwsUserEmail,
      sessions: currentSessions,
      activeModel,
      widgetsEnabled: config.widgets_enabled !== false,
      theme: config.theme || 'system'
    }));

    ws.on('message', async (message) => {
      try {
        const input = JSON.parse(message);
        
        if (input.type === 'confirm') {
          const sId = input.sessionId || sessionId;
          const resolve = global.pendingConfirmResolvers?.get(sId);
          if (resolve) {
            resolve(input.approved === true);
            global.pendingConfirmResolvers.delete(sId);
          }
        } else if (input.type === 'message') {
          const text = (input.text || '').trim();
          if (!text) return;

          if (text === '/help' || text === 'help' || text.toLowerCase() === 'what can i do' || text.toLowerCase() === 'what can you do') {
            const helpText = getHelpText();
            ws.send(JSON.stringify({ type: 'message', sender: 'agent', text: helpText }));
            saveMessage(sessionId, 'assistant', helpText);
          } else if (text.startsWith('/models')) {
            const config = readConfig();
            const modelsMsg = `⚙️ **Switch Active Provider / Model**\nCurrent Active Model: **${config.active_provider}** (${config.active_model})\n\nTo switch provider or model, please configure it by running \`cloudagent config\` in your terminal or modify \`config.json\` inside your home directory under \`.cloudagent/\`.`;
            ws.send(JSON.stringify({ type: 'message', sender: 'agent', text: modelsMsg }));
            saveMessage(sessionId, 'assistant', modelsMsg);
          } else {
            // Run agent step with websocket output handler
            await runAgentStepJSON(sessionId, text, (data) => {
              ws.send(JSON.stringify(data));
            });
          }
        } else if (input.type === 'get_diagnostics') {
          const diagnostics = await getDiagnosticsStatus();
          ws.send(JSON.stringify({ type: 'diagnostics', ...diagnostics }));
        } else if (input.type === 'get_dashboard') {
          const dashboardData = await getDashboardData();
          ws.send(JSON.stringify({ type: 'dashboard', data: dashboardData }));
        } else if (input.type === 'get_config') {
          const config = readConfig();
          ws.send(JSON.stringify({ type: 'config', config }));
        } else if (input.type === 'update_config') {
          const config = readConfig();
          if (input.activeProvider) config.active_provider = input.activeProvider;
          if (input.activeModel) config.active_model = input.activeModel;
          if (input.widgetsEnabled !== undefined) config.widgets_enabled = input.widgetsEnabled;
          if (input.theme) config.theme = input.theme;
          if (input.providers) {
            for (const [prov, provData] of Object.entries(input.providers)) {
              if (!config.providers[prov]) config.providers[prov] = {};
              if (provData.api_key !== undefined) config.providers[prov].api_key = provData.api_key;
            }
          }
          writeConfig(config);
          
          ws.send(JSON.stringify({
            type: 'session',
            sessionId,
            workspace: process.cwd(),
            gwsUserEmail,
            sessions: getSessions(),
            activeModel: config.active_model,
            widgetsEnabled: config.widgets_enabled !== false,
            theme: config.theme || 'system'
          }));
        } else if (input.type === 'stop_session') {
          activeRuns.set(input.sessionId, false);
          ws.send(JSON.stringify({ type: 'status', sessionId: input.sessionId, status: 'idle' }));
        } else if (input.type === 'ai_rename_session') {
          const sId = input.sessionId;
          const messages = getSessionMessages(sId);
          if (messages.length > 0) {
            try {
              const userPrompts = messages.filter(m => m.role === 'user').map(m => m.content);
              if (userPrompts.length > 0) {
                const provider = getActiveProvider();
                const prompt = `Based on the following user prompts, please generate a short, clean, descriptive title for this conversation. Output ONLY the title (maximum 4-5 words, no quotes, no markdown, no punctuation).
Prompts:
${userPrompts.join('\n')}
Title:`;
                const aiResponse = await provider.generateToolCall([{ role: 'user', content: prompt }], []);
                const cleanTitle = (aiResponse.text || aiResponse.thought || 'New Chat').trim().replace(/['"“”]/g, '');
                updateSessionName(sId, cleanTitle);
              }
            } catch (e) {
              console.error('Error auto-renaming session:', e.message);
            }
          }
          const freshSessions = getSessions();
          ws.send(JSON.stringify({
            type: 'session',
            sessionId,
            workspace: process.cwd(),
            gwsUserEmail,
            sessions: freshSessions,
            activeModel: config.active_model,
            widgetsEnabled: config.widgets_enabled !== false,
            theme: config.theme || 'system'
          }));
        } else if (input.type === 'switch_session') {
          sessionId = input.sessionId;
          const history = getSessionMessages(sessionId);
          
          const formattedHistory = [];
          for (let i = 0; i < history.length; i++) {
            const h = history[i];
            try {
              const parsed = JSON.parse(h.content);
              if (parsed.tool && !parsed.status) {
                // This is a tool call start. Let's look ahead for the result
                let output = 'Running...';
                let status = 'running';
                if (i + 1 < history.length) {
                  try {
                    const nextParsed = JSON.parse(history[i + 1].content);
                    if (nextParsed.tool === parsed.tool && (nextParsed.status === 'success' || nextParsed.status === 'failed')) {
                      output = nextParsed.status === 'success' ? nextParsed.output : nextParsed.error;
                      status = nextParsed.status;
                      i++; // skip next since we merged it
                    }
                  } catch (err) {}
                }
                formattedHistory.push({
                  sender: 'tool',
                  text: `Executed ${parsed.tool}`,
                  meta: {
                    type: 'tool',
                    name: parsed.tool,
                    arguments: parsed.arguments,
                    output: output,
                    status: status,
                    isExpanded: false // default collapsed in history
                  }
                });
                continue;
              }
            } catch (e) {}

            // Process normally
            let contentText = h.content;
            try {
              const parsed = JSON.parse(h.content);
              if (parsed.text) {
                contentText = parsed.text;
              } else if (parsed.status === 'success') {
                contentText = tryFormatSuccess(parsed.tool, parsed.output);
              } else if (parsed.status === 'failed') {
                contentText = `Tool execution failed: ${parsed.error}`;
              }
            } catch (e) {}

            if (contentText.startsWith('{') && contentText.includes('"tool"')) continue;
            if (contentText.includes('[System Instruction:')) continue;

            formattedHistory.push({
              sender: h.role === 'user' ? 'user' : (h.role === 'assistant' ? 'agent' : 'system'),
              text: contentText
            });
          }

          ws.send(JSON.stringify({ type: 'history', sessionId, messages: formattedHistory }));
        } else if (input.type === 'new_session') {
          sessionId = 'session_' + Date.now();
          createSession(sessionId);
          const freshSessions = getSessions();
          ws.send(JSON.stringify({ type: 'session', sessionId, workspace: process.cwd(), gwsUserEmail, sessions: freshSessions }));
        } else if (input.type === 'delete_session') {
          deleteSession(input.sessionId);
          const freshSessions = getSessions();
          if (sessionId === input.sessionId) {
            sessionId = freshSessions.length > 0 ? freshSessions[0].id : 'session_' + Date.now();
            if (freshSessions.length === 0) {
              createSession(sessionId);
              freshSessions.push({ id: sessionId, name: 'New Chat', updated_at: new Date().toISOString() });
            }
          }
          ws.send(JSON.stringify({ type: 'session', sessionId, workspace: process.cwd(), gwsUserEmail, sessions: freshSessions }));
        } else if (input.type === 'rename_session') {
          updateSessionName(input.sessionId, input.name);
          const freshSessions = getSessions();
          ws.send(JSON.stringify({ type: 'session', sessionId, workspace: process.cwd(), gwsUserEmail, sessions: freshSessions }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: 'Server Error: ' + err.message }));
      }
    });

    ws.on('close', () => {
      console.log('🔌 Client disconnected');
      for (const [sId, socket] of activeSockets.entries()) {
        if (socket === ws) {
          activeSockets.delete(sId);
          const resolve = global.pendingConfirmResolvers?.get(sId);
          if (resolve) {
            resolve(false);
            global.pendingConfirmResolvers.delete(sId);
          }
        }
      }
    });
  });
}

// Start immediately if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}
