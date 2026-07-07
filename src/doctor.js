import { execSync } from 'child_process';
import chalk from 'chalk';
import dns from 'dns';
import prompts from 'prompts';
import ora from 'ora';
import { readConfig } from './config.js';
import { initDatabase } from './db.js';

async function checkInternet() {
  return new Promise((resolve) => {
    dns.lookup('openrouter.ai', (err) => {
      resolve(!err);
    });
  });
}

function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch (error) {
    return null;
  }
}

// Helper to automatically install gws CLI
export async function ensureGwsInstalled() {
  const gwsVer = runCmd('gws --version');
  if (gwsVer) return true;

  console.log(chalk.yellow('\n⚠️  Google Workspace CLI (gws) is not installed.'));
  console.log(`CloudAgent relies on gws to interact with Google APIs.`);
  console.log(`For more info, visit: ${chalk.cyan('https://github.com/googleworkspace/cli')}\n`);

  const response = await prompts({
    type: 'confirm',
    name: 'install',
    message: 'Would you like CloudAgent to automatically install gws via npm?',
    initial: true
  });

  if (!response.install) {
    console.log(chalk.red('\nAutomatic installation cancelled. Please install gws manually:'));
    console.log(chalk.cyan('npm install -g @googleworkspace/cli\n'));
    return false;
  }

  const spinner = ora('Installing @googleworkspace/cli globally...').start();
  try {
    // Run global npm install
    execSync('npm install -g @googleworkspace/cli', { stdio: 'pipe' });
    spinner.succeed(chalk.green('Google Workspace CLI (gws) installed successfully!'));
    return true;
  } catch (error) {
    spinner.fail(chalk.red('Failed to install gws automatically.'));
    console.log(chalk.bold('\nInstallation Logs & Error:'));
    console.log(chalk.red(error.stderr?.toString() || error.message));
    console.log(chalk.yellow('\nPlease try running the command manually:'));
    console.log(chalk.cyan('  npm install -g @googleworkspace/cli'));
    console.log(`\nAlternatively, refer to the installation guide at: ${chalk.underline('https://github.com/googleworkspace/cli')}\n`);
    return false;
  }
}

// 4. gws installation & auth
export async function verifyGws(log) {
  let gwsVer = runCmd('gws --version');
  
  if (!gwsVer) {
    const installed = await ensureGwsInstalled();
    if (installed) {
      gwsVer = runCmd('gws --version');
    }
  }

  if (gwsVer) {
    log(`  ${chalk.green('✓')} gws CLI: Installed (${gwsVer})`);
    
    // Check authentication
    const gwsStatus = runCmd('gws auth status');
    let authenticated = false;
    let userEmail = '';
    
    if (gwsStatus) {
      try {
        const statusObj = JSON.parse(gwsStatus);
        authenticated = statusObj && statusObj.token_valid === true;
        userEmail = statusObj.user || '';
      } catch (e) {
        // Fallback to substring matching if JSON parsing fails
        authenticated = gwsStatus.toLowerCase().includes('authenticated') || gwsStatus.toLowerCase().includes('token_valid": true');
      }
    }

    if (authenticated) {
      log(`  ${chalk.green('✓')} gws Authentication: Active${userEmail ? ` (${userEmail})` : ''}`);
      return true;
    } else {
      log(`  ${chalk.yellow('⚠')} gws Authentication: Not authenticated`);
      log(`    ${chalk.dim('Please run: gws auth login')}`);
      return false;
    }
  } else {
    log(`  ${chalk.red('✗')} gws CLI: Not found in path`);
    log(`    ${chalk.dim('Please install from https://github.com/googleworkspace/cli')}`);
    return false;
  }
}

export async function runDiagnostics(silent = false) {
  const log = (text) => {
    if (!silent) console.log(text);
  };

  log(chalk.bold('\n☁️  Running CloudAgent Doctor Diagnostics...\n'));

  let healthy = true;

  // 1. Node.js Check
  const nodeVersion = process.version;
  log(`  ${chalk.green('✓')} Node.js: ${chalk.cyan(nodeVersion)}`);

  // 2. Internet Connection
  const isOnline = await checkInternet();
  if (isOnline) {
    log(`  ${chalk.green('✓')} Internet: Connected`);
  } else {
    log(`  ${chalk.red('✗')} Internet: Disconnected`);
    healthy = false;
  }

  // 3. API Keys configuration
  const config = readConfig();
  const activeProvider = config.active_provider;
  const activeKey = config.providers?.[activeProvider]?.api_key;
  if (activeKey) {
    log(`  ${chalk.green('✓')} Provider Auth: ${chalk.cyan(activeProvider)} API Key configured`);
  } else {
    log(`  ${chalk.yellow('⚠')} Provider Auth: No API Key configured for active provider "${activeProvider}"`);
    log(`    ${chalk.dim('Please set it using the interactive prompts or editing your config file.')}`);
  }

  // 4. gws CLI
  const gwsOk = await verifyGws(log);
  if (!gwsOk) {
    healthy = false;
  }

  // 5. Git installation
  const gitVer = runCmd('git --version');
  if (gitVer) {
    log(`  ${chalk.green('✓')} Git: Installed (${gitVer})`);
  } else {
    log(`  ${chalk.red('✗')} Git: Not found in path`);
    healthy = false;
  }

  // 6. GitHub CLI (gh)
  const ghVer = runCmd('gh --version');
  if (ghVer) {
    const ghAuth = runCmd('gh auth status');
    const isAuthenticated = ghAuth && ghAuth.toLowerCase().includes('logged in');
    log(`  ${chalk.green('✓')} GitHub CLI (gh): Installed (${isAuthenticated ? 'Authenticated' : 'Unauthenticated'})`);
  } else {
    log(`  ${chalk.yellow('⚠')} GitHub CLI (gh): Not found in path (optional but recommended)`);
  }

  // 7. Database Initialization
  try {
    initDatabase();
    log(`  ${chalk.green('✓')} SQLite Database: Initialized`);
  } catch (error) {
    log(`  ${chalk.red('✗')} SQLite Database: Failed to initialize (${error.message})`);
    healthy = false;
  }

  log('');
  if (healthy) {
    log(chalk.bold.green('All core dependencies satisfied! CloudAgent is ready to run.'));
  } else {
    log(chalk.bold.yellow('Some core requirements are missing. Please fix the red items above.'));
  }
  log('');

  return healthy;
}

export async function getDiagnosticsStatus() {
  const status = {
    healthy: true,
    checks: []
  };

  // 1. Node.js
  status.checks.push({
    name: 'Node.js Runtime',
    ok: true,
    critical: true,
    message: process.version
  });

  // 2. Internet Connection
  const isOnline = await checkInternet();
  status.checks.push({
    name: 'Internet Connection',
    ok: isOnline,
    critical: true,
    message: isOnline ? 'Connected' : 'Disconnected'
  });
  if (!isOnline) status.healthy = false;

  // 3. API Key
  const config = readConfig();
  const activeProvider = config.active_provider;
  const activeKey = config.providers?.[activeProvider]?.api_key;
  status.checks.push({
    name: 'LLM Provider Key',
    ok: !!activeKey,
    critical: true,
    message: activeKey ? `Configured (${activeProvider})` : `No API Key for active provider: ${activeProvider}`
  });
  if (!activeKey) status.healthy = false;

  // 4. gws CLI & Auth
  let gwsVer = runCmd('gws --version');
  status.checks.push({
    name: 'Google Workspace CLI (gws)',
    ok: !!gwsVer,
    critical: true,
    message: gwsVer ? `Installed (${gwsVer})` : 'Not found in path'
  });
  if (!gwsVer) status.healthy = false;

  let gwsAuth = false;
  let gwsUser = '';
  if (gwsVer) {
    const statusVal = runCmd('gws auth status');
    if (statusVal) {
      try {
        const statusObj = JSON.parse(statusVal);
        gwsAuth = statusObj && (statusObj.token_valid === true || statusObj.status === 'success');
        gwsUser = statusObj.user || statusObj.account || '';
      } catch (e) {
        gwsAuth = statusVal.toLowerCase().includes('authenticated') || statusVal.toLowerCase().includes('token_valid": true');
      }
    }
  }
  status.checks.push({
    name: 'Google Workspace Auth',
    ok: gwsAuth,
    critical: true,
    message: gwsAuth ? `Authenticated as ${gwsUser}` : 'Not authenticated (run "gws auth login")'
  });
  if (!gwsAuth) status.healthy = false;

  // 5. Git
  const gitVer = runCmd('git --version');
  status.checks.push({
    name: 'Git Version Control',
    ok: !!gitVer,
    critical: true,
    message: gitVer ? `Installed (${gitVer})` : 'Not found in path'
  });
  if (!gitVer) status.healthy = false;

  // 6. GitHub CLI (gh)
  const ghVer = runCmd('gh --version');
  let ghAuth = false;
  if (ghVer) {
    const authVal = runCmd('gh auth status');
    ghAuth = authVal && authVal.toLowerCase().includes('logged in');
  }
  status.checks.push({
    name: 'GitHub CLI (gh)',
    ok: !!ghVer,
    critical: false,
    message: ghVer ? `Installed (${ghAuth ? 'Authenticated' : 'Unauthenticated'})` : 'Not found (optional)'
  });

  // 7. Database Check
  let dbOk = false;
  let dbMsg = '';
  try {
    initDatabase();
    dbOk = true;
    dbMsg = 'Initialized';
  } catch (err) {
    dbMsg = err.message;
  }
  status.checks.push({
    name: 'SQLite Database',
    ok: dbOk,
    critical: true,
    message: dbOk ? dbMsg : `Failed to load: ${dbMsg}`
  });
  if (!dbOk) status.healthy = false;

  return status;
}
