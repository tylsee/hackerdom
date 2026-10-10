import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { startServer, shutdownServer } from '../src/server.js';
import { createLogger } from '../src/utils/logger.js';

const serverFile = fileURLToPath(new URL('../src/server.js', import.meta.url));
const servers = [];
const children = [];
const temporaryDirs = [];
const logger = createLogger({ level: 'silent' });
const config = { ...parseEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }), port: 0 };

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
  for (const server of servers.splice(0)) {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
  for (const dir of temporaryDirs.splice(0)) {
    // Milestone 3 creates an uploads/ subdirectory in each isolated test fixture.
    // rmSync handles nested files and directories; unlinkSync only handles files.
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('real server lifecycle', () => {
  it('binds a real HTTP listener and closes it cleanly', async () => {
    const server = await startServer({ config, logger });
    servers.push(server);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('ok');
    expect(await shutdownServer(server, { timeoutMs: 1000, logger, signal: 'test' })).toBe(true);
    expect(server.listening).toBe(false);
  });

  it('preserves jobs and their matching tokens across an HTTP server restart on the same database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docuai-server-db-test-'));
    temporaryDirs.push(dir);
    const persistentConfig = { ...config, databasePath: join(dir, 'persistent.sqlite') };
    let server = await startServer({ config: persistentConfig, logger });
    servers.push(server);
    const createResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { writingTone: 'academic', documentType: 'lab_report' } }),
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    await shutdownServer(server, { timeoutMs: 1000, logger, signal: 'test' });
    server = await startServer({ config: persistentConfig, logger });
    servers.push(server);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/${created.job.id}`, {
      headers: { Authorization: `Bearer ${created.accessToken}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: created.job });
  });

  it('forces a genuinely active response closed at the shutdown deadline without logging a clean stop', async () => {
    const logs = [];
    const capturedLogger = createLogger({ level: 'info', sink: { write: (line) => logs.push(JSON.parse(line)) } });
    // Use a test-only HTTP handler that deliberately never ends its response.
    // Incomplete request HEADERS are not a reliable shutdown test: recent Node
    // versions can close those sockets immediately as idle/unestablished.
    const activeServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('response still active');
    });
    await new Promise((resolveListen, rejectListen) => {
      activeServer.once('error', rejectListen);
      activeServer.listen(0, '127.0.0.1', () => {
        activeServer.off('error', rejectListen);
        resolveListen();
      });
    });
    servers.push(activeServer);

    const socket = connect(activeServer.address().port, '127.0.0.1');
    socket.on('error', () => {}); // Shutdown can reset a half-read socket.
    await once(socket, 'connect');
    const received = once(socket, 'data');
    socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
    await received; // Wait until the handler starts its response.
    // A forced shutdown may reset a socket; wait for close without rejecting on that reset.
    const closed = new Promise((resolveClose) => socket.once('close', resolveClose));
    try {
      const clean = await shutdownServer(activeServer, { timeoutMs: 50, logger: capturedLogger, signal: 'test' });
      expect(clean).toBe(false);
      await closed;
      expect(logs.some((entry) => entry.event === 'shutdown_timeout')).toBe(true);
      expect(logs.some((entry) => entry.event === 'server_stopped')).toBe(false);
    } finally {
      socket.destroy();
    }
  });

  it('rejects an occupied port without pretending startup succeeded', async () => {
    const server = await startServer({ config, logger });
    servers.push(server);
    await expect(startServer({ config: { ...config, port: server.address().port }, logger }))
      .rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('exits nonzero with safe diagnostics for invalid environment settings', () => {
    const result = spawnSync(process.execPath, [serverFile], {
      env: { ...process.env, PORT: 'secret-invalid-port', NODE_ENV: 'test', DATABASE_PATH: ':memory:' },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid environment configuration: PORT');
    expect(result.stderr).not.toContain('secret-invalid-port');
  });

  it('fails startup safely when the configured database cannot be opened', async () => {
    const badConfig = { ...config, databasePath: fileURLToPath(new URL('../src', import.meta.url)) };
    await expect(startServer({ config: badConfig, logger })).rejects.toMatchObject({ code: 'DATABASE_INIT_FAILED' });
    const result = spawnSync(process.execPath, [serverFile], {
      env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: badConfig.databasePath },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_INIT_FAILED');
    expect(result.stderr).not.toContain(badConfig.databasePath);
  });

  it('exits nonzero with a clear code when the port is in use', async () => {
    const server = await startServer({ config, logger });
    servers.push(server);
    const result = spawnSync(process.execPath, [serverFile], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(server.address().port), NODE_ENV: 'test', DATABASE_PATH: ':memory:' },
      encoding: 'utf8', timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PORT_IN_USE');
  });

  it('the actual entry point serves health and handles SIGTERM gracefully', async () => {
    const reservation = await startServer({ config, logger });
    const port = reservation.address().port;
    await shutdownServer(reservation, { timeoutMs: 1000, logger, signal: 'test' });
    const child = spawn(process.execPath, [serverFile], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', DATABASE_PATH: ':memory:', LOG_LEVEL: 'info' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const exit = once(child, 'exit');
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolveStarted, rejectStarted) => {
      const timer = setTimeout(() => rejectStarted(new Error('Server did not start in time')), 5000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('server_started')) { clearTimeout(timer); resolveStarted(); }
      });
      child.once('error', (error) => { clearTimeout(timer); rejectStarted(error); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (!stdout.includes('server_started')) rejectStarted(new Error('Server exited before startup'));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).service).toBe('docuai-backend');
    child.kill('SIGTERM');
    const [code, signal] = await exit;
    expect(code).toBe(0);
    expect(signal).toBeNull();
    expect(stdout).toContain('server_stopped');
    expect(stderr).toBe('');
  });
});
