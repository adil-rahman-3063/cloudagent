import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

function getGwsJsPath() {
  try {
    const npmRoot = execFileSync('cmd.exe', ['/c', 'npm', 'root', '-g']).toString().trim();
    const gwsPath = path.join(npmRoot, '@googleworkspace/cli/run.js');
    if (fs.existsSync(gwsPath)) {
      return gwsPath;
    }
  } catch (e) {
    // fallback
  }
  return null;
}

const gwsJsPath = getGwsJsPath();
console.log('Detected GWS JS Path:', gwsJsPath);

if (gwsJsPath) {
  try {
    // Test version command using node directly
    const out = execFileSync('node', [gwsJsPath, '--version']).toString();
    console.log('node direct gws success:', out);
  } catch (e) {
    console.error('node direct gws failed:', e.message);
  }
}
