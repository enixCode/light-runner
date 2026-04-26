import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-attach-'));
process.env.LIGHT_RUNNER_STATE_DIR = stateDir;

const { DockerRunner } = await import('../../src/DockerRunner.js');
const { writeState, readState } = await import('../../src/state.js');

maybe('DockerRunner.attach', () => {
  after(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('returns null for an unknown id', () => {
    const exec = DockerRunner.attach('does-not-exist');
    assert.equal(exec, null);
  });

  it('returns an immediately-resolved Execution for a terminal state', async () => {
    writeState({
      id: 'already-done',
      container: 'already-done',
      volume: 'already-done',
      image: 'alpine:3.19',
      workdir: '/app',
      startedAt: new Date(Date.now() - 60000).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 60000,
      status: 'exited',
      exitCode: 0,
    });
    const exec = DockerRunner.attach('already-done');
    assert.ok(exec, 'expected Execution for terminal state');
    const result = await exec!.result;
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.cancelled, false);
  });

  it('reports cancelled=true for a cancelled terminal state', async () => {
    writeState({
      id: 'was-cancelled',
      container: 'was-cancelled',
      volume: 'was-cancelled',
      image: 'alpine:3.19',
      workdir: '/app',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 100,
      status: 'cancelled',
      cancelled: true,
      exitCode: 137,
    });
    const exec = DockerRunner.attach('was-cancelled');
    const result = await exec!.result;
    assert.equal(result.cancelled, true);
    assert.equal(result.success, false);
  });

  it('marks a ghost running state as failed and resolves with failure', async () => {
    // Write a state claiming the container is running, but the container
    // name is nonsense so docker inspect will say it doesn't exist.
    writeState({
      id: 'ghost-run',
      container: 'light-runner-this-does-not-exist-12345',
      volume: 'light-runner-this-does-not-exist-12345',
      image: 'alpine:3.19',
      workdir: '/app',
      startedAt: new Date().toISOString(),
      status: 'running',
    });
    const exec = DockerRunner.attach('ghost-run');
    const result = await exec!.result;
    assert.equal(result.success, false);
    // State file updated to failed.
    const after = readState('ghost-run');
    assert.equal(after?.status, 'failed');
    assert.ok(after?.finishedAt);
  });

  it('attaches to a live detached run and resolves when it exits', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 1 && echo ok',
      timeout: 30000,
      network: 'none',
      detached: true,
    });
    // Attach with a second handle while the container is still running.
    // Poll briefly until the state file appears (writeState happens after
    // seed + docker run which can take ~500-2000ms on Docker Desktop).
    let attached: ReturnType<typeof DockerRunner.attach> = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !attached) {
      const s = readState(exec.id);
      if (s && s.status === 'running') {
        attached = DockerRunner.attach(exec.id);
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(attached, 'expected to attach while run is live');

    // Both handles should resolve. The original run does the real cleanup;
    // the attach call runs its own docker wait + cleanup in parallel.
    const originalResult = await exec.result;
    const attachResult = await attached!.result;
    assert.equal(originalResult.exitCode, 0);
    assert.equal(attachResult.exitCode, 0);
  });
});

maybe('DockerRunner.list', () => {
  after(() => {
    for (const f of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, f), { force: true });
  });

  it('returns every state on disk', () => {
    writeState({
      id: 'list-a', container: 'list-a', volume: 'list-a',
      image: 'alpine:3.19', workdir: '/app',
      startedAt: new Date().toISOString(), status: 'exited', exitCode: 0,
    });
    writeState({
      id: 'list-b', container: 'list-b', volume: 'list-b',
      image: 'alpine:3.19', workdir: '/app',
      startedAt: new Date().toISOString(), status: 'running',
    });
    const states = DockerRunner.list();
    const ids = states.map((s) => s.id).sort();
    assert.ok(ids.includes('list-a'));
    assert.ok(ids.includes('list-b'));
  });
});

maybe('DockerRunner.cleanupOrphanStates', () => {
  after(() => {
    for (const f of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, f), { force: true });
  });

  it('marks running states with missing containers as failed', async () => {
    writeState({
      id: 'orphan-state',
      container: 'light-runner-nope-nope-nope-12345',
      volume: 'light-runner-nope-nope-nope-12345',
      image: 'alpine:3.19',
      workdir: '/app',
      startedAt: new Date().toISOString(),
      status: 'running',
    });
    writeState({
      id: 'terminal-state',
      container: 'light-runner-whatever',
      volume: 'light-runner-whatever',
      image: 'alpine:3.19',
      workdir: '/app',
      startedAt: new Date().toISOString(),
      status: 'exited',
      exitCode: 0,
    });
    const fixed = await DockerRunner.cleanupOrphanStates();
    assert.ok(fixed >= 1, 'expected at least one orphan fixed');
    assert.equal(readState('orphan-state')?.status, 'failed');
    // Terminal state should be untouched.
    assert.equal(readState('terminal-state')?.status, 'exited');
  });
});
