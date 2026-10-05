import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookOrbitClient } from './api.js';

const PORT = 47_318;

interface MockState {
  loginCount: number;
  refreshCount: number;
  currentAccess: string | null;
  currentRefresh: string | null;
  rejectNextRefresh: boolean;
}

const state: MockState = {
  loginCount: 0,
  refreshCount: 0,
  currentAccess: null,
  currentRefresh: null,
  rejectNextRefresh: false,
};

function creds(accessToken: string, refreshToken: string, accessExpiresMs: number) {
  return {
    accessToken,
    accessTokenExpiresAt: new Date(Date.now() + accessExpiresMs).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    sessionId: 1,
  };
}

let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const readBody = () =>
      new Promise<unknown>((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
      });

    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        state.loginCount += 1;
        state.currentAccess = 'access-1';
        state.currentRefresh = 'refresh-1';
        // Access token issued already expired so the next process must refresh.
        send(200, { ...creds('access-1', 'refresh-1', -1000), user: {} });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/auth/refresh') {
        const body = (await readBody()) as Record<string, unknown>;
        if (state.rejectNextRefresh || body.refreshToken !== state.currentRefresh) {
          state.rejectNextRefresh = false;
          send(401, { message: 'Unauthorized' });
          return;
        }
        state.refreshCount += 1;
        state.currentAccess = 'access-2';
        state.currentRefresh = 'refresh-2';
        send(200, creds('access-2', 'refresh-2', 15 * 60 * 1000));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/dashboard/widgets/reading-goal') {
        if (req.headers.authorization !== `Bearer ${state.currentAccess}`) {
          send(401, { message: 'Unauthorized' });
          return;
        }
        send(200, { goalBooks: 12, completedBooks: 18, year: 2026 });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/control') {
        const body = (await readBody()) as Record<string, unknown>;
        if (body.rejectNextRefresh) state.rejectNextRefresh = true;
        send(200, { ok: true });
        return;
      }
      send(404, { message: 'not found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('refresh-token reuse flow', () => {
  it('logs in once, then refreshes and reuses across client instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bo-auth-test-'));
    const sessionFile = join(dir, 'session.json');
    const base = `http://127.0.0.1:${PORT}`;
    const goal = () => new BookOrbitClient(base, 'u', 'p', { sessionFile }).getReadingGoal();

    // First client: fresh login, session persisted at 0600.
    expect((await goal()).goalBooks).toBe(12);
    expect(state.loginCount).toBe(1);
    expect(state.refreshCount).toBe(0);
    expect(readFileSync(sessionFile, 'utf8')).toContain('refresh-1');
    expect(statSync(sessionFile).mode & 0o777).toBe(0o600);

    // Second client (fresh instance, persisted access token expired): refresh, no login.
    expect((await goal()).goalBooks).toBe(12);
    expect(state.loginCount).toBe(1);
    expect(state.refreshCount).toBe(1);
    expect(readFileSync(sessionFile, 'utf8')).toContain('refresh-2');

    // Third client: valid stored access token is reused without any auth call.
    expect((await goal()).goalBooks).toBe(12);
    expect(state.loginCount).toBe(1);
    expect(state.refreshCount).toBe(1);

    // Fourth client: expired access + revoked refresh falls back to login.
    await fetch(`${base}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectNextRefresh: true }),
    });
    const stale = JSON.parse(readFileSync(sessionFile, 'utf8'));
    stale.accessTokenExpiresAt = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(sessionFile, JSON.stringify(stale));
    expect((await goal()).goalBooks).toBe(12);
    expect(state.loginCount).toBe(2);
    expect(state.refreshCount).toBe(1);
  });
});
