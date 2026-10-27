import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BASE_URL_ENV,
  DEFAULT_SYSTEM_KEY_FILE,
  loadConfig,
  SYSTEM_KEY_ENV,
  SYSTEM_KEY_FILE_ENV,
} from './config.js';
import { TEST_BASE_URL, TEST_SYSTEM_KEY } from './testing.js';

const baseEnv = { [BASE_URL_ENV]: TEST_BASE_URL };

describe('loadConfig', () => {
  it('uses the env credential and does not read the key file', () => {
    let reads = 0;
    const config = loadConfig(
      { ...baseEnv, [SYSTEM_KEY_ENV]: `  ${TEST_SYSTEM_KEY}\n` },
      () => {
        reads += 1;
        return 'should-not-be-read';
      },
    );
    assert.equal(config.baseUrl, TEST_BASE_URL);
    assert.equal(config.apiKey, TEST_SYSTEM_KEY);
    assert.equal(reads, 0);
  });

  it('reads the default key file when the env credential is unset', () => {
    const seen: string[] = [];
    const config = loadConfig(baseEnv, (filePath) => {
      seen.push(filePath);
      return `${TEST_SYSTEM_KEY}\n`;
    });
    assert.equal(config.apiKey, TEST_SYSTEM_KEY);
    assert.equal(seen.length, 1);
    assert.ok(seen[0]?.endsWith('/.secrets/archetype_system_key'));
  });

  it('reads ARCHETYPE_SYSTEM_KEY_FILE and expands a leading tilde', () => {
    const seen: string[] = [];
    loadConfig(
      { ...baseEnv, [SYSTEM_KEY_FILE_ENV]: '~/vault/system-key' },
      (filePath) => {
        seen.push(filePath);
        return TEST_SYSTEM_KEY;
      },
    );
    assert.equal(seen.length, 1);
    assert.ok(seen[0]?.endsWith('/vault/system-key'));
    assert.ok(!seen[0]?.startsWith('~'));
  });

  it('rejects a missing key without echoing a path from the environment', () => {
    assert.throws(
      () => loadConfig(
        { ...baseEnv, [SYSTEM_KEY_FILE_ENV]: '/tmp/does-not-exist-key' },
        () => {
          throw new Error('ENOENT: /tmp/does-not-exist-key');
        },
      ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(SYSTEM_KEY_ENV));
        assert.match(err.message, new RegExp(DEFAULT_SYSTEM_KEY_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.doesNotMatch(err.message, /ENOENT/);
        assert.doesNotMatch(err.message, /does-not-exist-key/);
        return true;
      },
    );
  });

  it('rejects an empty file and a non-service credential without logging the value', () => {
    assert.throws(
      () => loadConfig(baseEnv, () => '   \n'),
      /System key file is empty/,
    );
    assert.throws(
      () => loadConfig({ ...baseEnv, [SYSTEM_KEY_ENV]: 'not-a-service-credential' }, () => ''),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /sys_/);
        assert.doesNotMatch(err.message, /not-a-service-credential/);
        return true;
      },
    );
  });

  it('rejects a base URL with a path, credentials, or a non-http scheme', () => {
    assert.throws(() => loadConfig({ [BASE_URL_ENV]: 'https://backend.example/api', [SYSTEM_KEY_ENV]: TEST_SYSTEM_KEY }), /no path/);
    assert.throws(() => loadConfig({ [BASE_URL_ENV]: 'http://user:x@127.0.0.1', [SYSTEM_KEY_ENV]: TEST_SYSTEM_KEY }), /credentials/);
    assert.throws(() => loadConfig({ [BASE_URL_ENV]: 'ftp://backend.example', [SYSTEM_KEY_ENV]: TEST_SYSTEM_KEY }), /http or https/);
    assert.throws(() => loadConfig({ [SYSTEM_KEY_ENV]: TEST_SYSTEM_KEY }), new RegExp(BASE_URL_ENV));
  });

  it('strips a trailing slash from the origin', () => {
    const config = loadConfig({
      [BASE_URL_ENV]: `${TEST_BASE_URL}/`,
      [SYSTEM_KEY_ENV]: TEST_SYSTEM_KEY,
    });
    assert.equal(config.baseUrl, TEST_BASE_URL);
  });
});
