import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.cloudagent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const MODELS_FILE = path.join(CONFIG_DIR, 'models.json');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

const DEFAULT_MODELS = [
  // Tier 1 — Best
  "openai/gpt-oss-120b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  
  // Tier 2 — Good
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "poolside/laguna-m.1:free",
  "poolside/laguna-xs.2:free",
  
  // Tier 3 — Fallback
  "liquid/lfm-2.5-1.2b-thinking:free",
  "liquid/lfm-2.5-1.2b-instruct:free",
  "meta-llama/llama-3.2-3b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "qwen/qwen3-coder:free",
  
  // Last resort
  "openrouter/free"
];

export function readModels() {
  initConfigDirs();
  if (!fs.existsSync(MODELS_FILE)) {
    fs.writeFileSync(MODELS_FILE, JSON.stringify(DEFAULT_MODELS, null, 2), 'utf8');
    return DEFAULT_MODELS;
  }
  try {
    return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  } catch (error) {
    return DEFAULT_MODELS;
  }
}


// Ensure system directories exist
export function initConfigDirs() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

// Default configuration structure
const DEFAULT_CONFIG = {
  active_provider: 'openrouter',
  active_model: 'google/gemini-2.5-flash', // Default placeholder model
  timezone: '',
  providers: {
    openrouter: { api_key: '' },
    openai: { api_key: '' },
    gemini: { api_key: '' },
    anthropic: { api_key: '' }
  }
};

export function readConfig() {
  initConfigDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    const dConf = { ...DEFAULT_CONFIG, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(dConf, null, 2), 'utf8');
    return dConf;
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed.timezone) {
      parsed.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(parsed, null, 2), 'utf8');
    }
    return parsed;
  } catch (error) {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(config) {
  initConfigDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function getProviderKey(providerName) {
  const config = readConfig();
  return config.providers?.[providerName]?.api_key || '';
}

export function setProviderKey(providerName, apiKey) {
  const config = readConfig();
  if (!config.providers) config.providers = {};
  if (!config.providers[providerName]) config.providers[providerName] = {};
  config.providers[providerName].api_key = apiKey;
  writeConfig(config);
}

import { execFileSync, spawn } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';

let cachedGwsJsPath = null;
let searchedGws = false;

function getGwsJsPath() {
  if (searchedGws) return cachedGwsJsPath;
  searchedGws = true;
  try {
    const npmRoot = execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/c', 'npm', 'root', '-g'] : ['root', '-g']).toString().trim();
    const gwsPath = path.join(npmRoot, '@googleworkspace/cli/run.js');
    if (fs.existsSync(gwsPath)) {
      cachedGwsJsPath = gwsPath;
    }
  } catch (e) {
    // fallback
  }
  return cachedGwsJsPath;
}

export function execGws(args, options = {}) {
  return new Promise((resolve, reject) => {
    const gwsJs = getGwsJsPath();
    let cmd = 'gws';
    let cmdArgs = args;
    if (gwsJs) {
      cmd = 'node';
      cmdArgs = [gwsJs, ...args];
    } else if (process.platform === 'win32') {
      cmd = 'cmd.exe';
      cmdArgs = ['/c', 'gws', ...args];
    }

    const child = spawn(cmd, cmdArgs, { ...options, stdio: 'pipe' });
    let stdout = [];
    let stderr = [];

    child.stdout.on('data', (data) => {
      stdout.push(data);
      if (typeof global.gwsLogCallback === 'function') {
        const lines = data.toString().split(/[\r\n]+/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            global.gwsLogCallback(trimmed);
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderr.push(data);
      if (typeof global.gwsLogCallback === 'function') {
        const lines = data.toString().split(/[\r\n]+/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            global.gwsLogCallback(trimmed);
          }
        }
      }
    });

    child.on('close', (code) => {
      const outBuffer = Buffer.concat(stdout);
      const errBuffer = Buffer.concat(stderr);

      if (code === 0) {
        resolve(outBuffer);
      } else {
        const err = new Error(`gws exited with code ${code}`);
        err.stderr = errBuffer;
        reject(err);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

export let workspaceAllowed = false;
export function setWorkspaceAllowed(allowed) {
  workspaceAllowed = allowed;
}

export { CONFIG_DIR, SESSIONS_DIR, LOGS_DIR };
