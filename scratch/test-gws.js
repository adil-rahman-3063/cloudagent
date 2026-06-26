import { execFileSync } from 'child_process';

try {
  const out = execFileSync('gws.cmd', ['--version']).toString();
  console.log('gws.cmd direct success:', out);
} catch (e) {
  console.error('gws.cmd direct failed:', e.message);
}

try {
  const out = execFileSync('cmd.exe', ['/c', 'gws', '--version']).toString();
  console.log('cmd.exe gws success:', out);
} catch (e) {
  console.error('cmd.exe gws failed:', e.message);
}
