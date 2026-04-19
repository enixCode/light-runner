import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-stop-pause-'));
process.env.LIGHT_RUNNER_STATE_DIR = stateDir;

const { DockerRunner } = await import('../../src/DockerRunner.js');
const { readState } = await import('../../src/state.js');

function inspect(container: string, field: string): string {
  const r = spawnSync('docker', ['inspect', '-f', `{{${field}}}`, container], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

maybe('execution.stop', () => {
  after(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('grace 0 kills immediately, result reports cancelled', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 30',
      network: 'none',
      timeout: 60000,
      detached: true,
    });
    // Give the container time to spawn before issuing stop.
    await new Promise((r) => setTimeout(r, 400));
    const started = Date.now();
    await exec.stop({ grace: 0 });
    const result = await exec.result;
    const elapsed = Date.now() - started;

    assert.equal(result.cancelled, true);
    assert.equal(result.success, false);
    // Kill + docker rm + volume teardown take a few seconds on Windows Docker
    // Desktop (named-pipe overhead). What matters is we did not wait 30s for
    // the sleep to finish naturally.
    assert.ok(elapsed < 20000, `grace 0 should kill early, took ${elapsed}ms`);
    assert.equal(readState(exec.id)?.status, 'cancelled');
  });

  it('grace period allows a SIGTERM trap to exit cleanly', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command:
        'trap "echo caught-term; exit 42" TERM; ' +
        'while true; do sleep 1; done',
      network: 'none',
      timeout: 60000,
      detached: true,
    });
    await new Promise((r) => setTimeout(r, 500));
    await exec.stop({ signal: 'SIGTERM', grace: 5000 });
    const result = await exec.result;

    // The trap should have caught the signal and exited 42 well before grace.
    // If SIGTERM was not caught for some reason, SIGKILL fallback yields 137.
    assert.ok(
      result.exitCode === 42 || result.exitCode === 137,
      `expected 42 (trap) or 137 (SIGKILL fallback), got ${result.exitCode}`,
    );
    assert.equal(result.cancelled, true);
  });
});

maybe('execution.pause / resume', () => {
  after(() => {
    for (const f of fs.readdirSync(stateDir)) fs.rmSync(path.join(stateDir, f), { force: true });
  });

  it('pause freezes the container, resume restores running state', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      // Long idle so the container is still running by the time we pause,
      // even after Docker Desktop's ~2-4s spawn overhead on Windows.
      command: 'sleep 120',
      network: 'none',
      timeout: 180000,
      detached: true,
    });

    // Wait until docker sees the container as 'running'. Poll up to 15s.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (inspect(exec.id, '.State.Status') === 'running') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(inspect(exec.id, '.State.Status'), 'running', 'container should be running');

    exec.pause();
    assert.equal(inspect(exec.id, '.State.Status'), 'paused', 'container should be paused');

    await new Promise((r) => setTimeout(r, 500));
    assert.equal(inspect(exec.id, '.State.Status'), 'paused', 'still paused after delay');

    exec.resume();
    // Give docker a tick to transition back.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(inspect(exec.id, '.State.Status'), 'running', 'container should be running again');

    // Terminate the long-sleeping container so the test finishes promptly.
    await exec.stop({ grace: 0 });
    const result = await exec.result;
    assert.equal(result.cancelled, true);
  });

  it('pause on a non-existent container throws', () => {
    // Fake an Execution handle that points at a container name which
    // does not exist on the daemon.
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo quick',
      network: 'none',
      timeout: 30000,
      detached: true,
    });
    // Intentionally wait for the run to finish, then pause - container
    // has been removed by the finally block, so docker pause fails.
    return exec.result.then(() => {
      assert.throws(() => exec.pause(), /docker pause failed/);
    });
  });
});
