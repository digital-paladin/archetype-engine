import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Backend origin. No path, query, hash, or embedded credentials. */
export const BASE_URL_ENV = 'ARCHETYPE_API_BASE_URL';

/**
 * Service credential (`sys_` + 64 hex characters).
 * When this is non-empty it wins over the key file.
 */
export const SYSTEM_KEY_ENV = 'ARCHETYPE_SYSTEM_KEY';

/** File whose contents are the service credential. Default: ~/.secrets/archetype_system_key */
export const SYSTEM_KEY_FILE_ENV = 'ARCHETYPE_SYSTEM_KEY_FILE';

export const DEFAULT_SYSTEM_KEY_FILE = '~/.secrets/archetype_system_key';

/** Shape minted by `serviceCredential.store.ts`: `sys_` plus 32 random bytes as hex. */
const SERVICE_KEY = /^sys_[0-9a-f]{64}$/;

export interface ServerConfig {
  baseUrl: string;
  apiKey: string;
}

export type ReadFile = (filePath: string) => string;

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function requireServiceKey(raw: string): string {
  const apiKey = raw.trim();
  if (!SERVICE_KEY.test(apiKey)) {
    throw new Error(
      `${SYSTEM_KEY_ENV} must be a System service credential (sys_ and 64 lowercase hex characters). The value was not logged.`,
    );
  }
  return apiKey;
}

function requireBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${BASE_URL_ENV} is required (the backend origin, such as https://backend.example).`);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${BASE_URL_ENV} must be an absolute http(s) URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${BASE_URL_ENV} must use http or https.`);
  }
  if (url.username || url.password) {
    throw new Error(`${BASE_URL_ENV} must not include credentials.`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${BASE_URL_ENV} must be the backend origin with no path.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${BASE_URL_ENV} must be the backend origin with no query or hash.`);
  }
  return url.origin;
}

/**
 * Load the backend origin and the System service credential.
 * Never includes the credential in an error message.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadFile = (filePath) => fs.readFileSync(filePath, 'utf8'),
): ServerConfig {
  const baseUrl = requireBaseUrl(env[BASE_URL_ENV] ?? '');
  const fromEnv = env[SYSTEM_KEY_ENV];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { baseUrl, apiKey: requireServiceKey(fromEnv) };
  }

  const configured = (env[SYSTEM_KEY_FILE_ENV] ?? '').trim();
  const filePath = expandHome(configured || DEFAULT_SYSTEM_KEY_FILE);
  let raw: string;
  try {
    raw = readFile(filePath);
  } catch {
    throw new Error(
      `${SYSTEM_KEY_ENV} is unset and the System key file could not be read. Set ${SYSTEM_KEY_ENV}, or set ${SYSTEM_KEY_FILE_ENV} to a file that contains the credential. The default path is ${DEFAULT_SYSTEM_KEY_FILE}.`,
    );
  }
  if (raw.trim() === '') {
    throw new Error('The System key file is empty. The file contents were not logged.');
  }
  return { baseUrl, apiKey: requireServiceKey(raw) };
}
