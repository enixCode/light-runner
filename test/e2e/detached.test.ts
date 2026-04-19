import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

/*
 * Detached mode needs an isolated state dir per test suite so we don't clash
 * with other runs on the host machine. Set the env before importing the
 * modules that read STATE_DIR at load time.
 */
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-detached-'));
process.env.LIGHT_RUNNER_STATE_DIR = stateDir;

const { DockerRunner } = await import('../../src/DockerRunner.js');
const { listStates, readState } = await import('../../src/state.js');

maybe('DockerRunner.run detached', () => {
  after(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it('runs a detached container and resolves with success', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo hello',
      timeout: 30000,
      network: 'none',
      detached: true,
    });
    const result = await exec.result;
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.cancelled, false);
  });

  it('persists a complete state file after a detached run', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo done',
      timeout: 30000,
      network: 'none',
      detached: true,
    });
    await exec.result;

    const state = readState(exec.id);
    assert.ok(state, 'state file should exist after exit');
    assert.equal(state?.status, 'exited');
    assert.equal(state?.exitCode, 0);
    assert.ok(state?.startedAt);
    assert.ok(state?.finishedAt);
    assert.ok(state?.durationMs !== undefined && state.durationMs >= 0);
    assert.equal(state?.image, 'alpine:3.19');
    assert.equal(state?.container, exec.id);
  });

  it('listStates includes the detached run after it completes', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo ok',
      timeout: 30000,
      network: 'none',
      detached: true,
    });
    await exec.result;
    const states = listStates();
    const found = states.find((s) => s.id === exec.id);
    assert.ok(found, `expected state for ${exec.id} in listStates()`);
    assert.equal(found?.status, 'exited');
  });

  it('extracts files after a successful detached run', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-d-ext-'));
    try {
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'alpine:3.19',
        command: 'echo detached > /app/out.txt',
        timeout: 30000,
        network: 'none',
        detached: true,
        extract: [{ from: '/app/out.txt', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      assert.ok(result.extracted);
      assert.equal(result.extracted![0].status, 'ok');
      assert.equal(
        fs.readFileSync(path.join(outDir, 'out.txt'), 'utf8').trim(),
        'detached',
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('cancel on a detached execution marks the state as cancelled', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 30',
      timeout: 60000,
      network: 'none',
      detached: true,
    });
    // Give the container time to boot before cancelling.
    setTimeout(() => exec.cancel(), 500);
    const result = await exec.result;
    assert.equal(result.cancelled, true);
    assert.equal(result.success, false);
    const state = readState(exec.id);
    assert.equal(state?.cancelled, true);
    assert.equal(state?.status, 'cancelled');
  });

  it('rejects detached + input at the API boundary', () => {
    const runner = new DockerRunner();
    assert.throws(
      () =>
        runner.run({
          image: 'alpine:3.19',
          command: 'cat',
          detached: true,
          input: { foo: 'bar' },
        }),
      /input is not supported with detached/,
    );
  });
});
