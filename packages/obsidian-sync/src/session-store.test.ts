import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSessionFile, saveSessionFile } from './session-store.js';
import type { TokenCredentials } from './types.js';

const creds: TokenCredentials = {
  accessToken: 'access-1',
  accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  refreshToken: 'refresh-1',
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  sessionId: 42,
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bo-session-test-'));
  file = join(dir, 'session.json');
});

afterEach(() => {
  // Cleanup is best-effort; the OS temp dir is fine either way.
});

describe('session-store', () => {
  it('round-trips credentials', async () => {
    await saveSessionFile(file, creds);
    const loaded = await loadSessionFile(file);
    expect(loaded).toEqual(expect.objectContaining(creds));
    expect(loaded?.accessToken).toBe('access-1');
  });

  it('writes a 0600 file', async () => {
    const { statSync } = await import('node:fs');
    await saveSessionFile(file, creds);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('returns null for a missing file', async () => {
    expect(await loadSessionFile(join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for corrupt content', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, 'not json');
    expect(await loadSessionFile(file)).toBeNull();
  });
});
