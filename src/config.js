import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.cloudagent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    return DEFAULT_CONFIG;
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
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

export let workspaceAllowed = false;
export function setWorkspaceAllowed(allowed) {
  workspaceAllowed = allowed;
}

export { CONFIG_DIR, SESSIONS_DIR, LOGS_DIR };
