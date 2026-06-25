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
  "moonshotai/kimi-k2.6:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  
  // Tier 2 — Good
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free",
  "z-ai/glm-4.5-air:free",
  "poolside/laguna-m.1:free",
  "poolside/laguna-xs.2:free",
  
  // Tier 3 — Fallback
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
