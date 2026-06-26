import { executeTool } from '../src/tool-registry.js';
import { setWorkspaceAllowed } from '../src/config.js';

// Enable workspace permission for testing
setWorkspaceAllowed(true);

async function test() {
  console.log('Testing git_status...');
  const resStatus = await executeTool('git_status', {}, 'test-session', true);
  console.log('git_status result:', resStatus);

  console.log('\nTesting git_push (dry-run style if possible, or actual status)...');
  // git_push is high risk so normally it needs confirm, but executeTool with silent=true skips prompt?
  // Wait, executeTool has "approved = true" if risk is safe, but for 'high' it prompts unless we mock prompts.
  // Let's see if we can mock prompts or just test gitStatus and gitPull which are safe.
  const resPull = await executeTool('git_pull', {}, 'test-session', true);
  console.log('git_pull result:', resPull);
}

test();
