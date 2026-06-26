import { initDatabase, createSession } from '../src/db.js';
import { setWorkspaceAllowed } from '../src/config.js';
import { executeTool } from '../src/tool-registry.js';
import { askAgent } from '../src/agent.js';
import { getToolsSchema } from '../src/tool-registry.js';

// Setup environment
initDatabase();
const sessionId = 'test_session_' + Date.now();
createSession(sessionId);
setWorkspaceAllowed(true);

async function runAgentStepSimulated(sessionId, userPrompt) {
  console.log(`\nUser Prompt: "${userPrompt}"`);
  
  const history = [
    { role: 'user', content: userPrompt }
  ];
  const tools = getToolsSchema();
  
  try {
    // Ask the agent
    const response = await askAgent(history, tools);
    console.log('Agent Thought:', response.thought);
    
    if (response.tool) {
      console.log(`Agent wants to run tool: ${response.tool} with args:`, response.arguments);
      const result = await executeTool(response.tool, response.arguments || {}, sessionId, false);
      console.log('Tool Result success:', result.success);
      console.log('Tool Output:\n', result.output || result.error);
    } else {
      console.log('Agent text response:', response.text);
    }
  } catch (error) {
    console.error('Error running agent step:', error);
  }
}

async function test() {
  await runAgentStepSimulated(sessionId, 'check my git status');
}

test();
