import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DockerRunner } from '../../src/DockerRunner.js';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

maybe('DockerRunner.run', () => {
  let seedDir: string;

  before(() => {
    seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-test-'));
    fs.writeFileSync(path.join(seedDir, 'hello.txt'), 'hello-world');
  });

  after(() => {
    fs.rmSync(seedDir, { recursive: true, force: true });
  });

  it('isAvailable returns true when docker is installed', async () => {
    assert.equal(await DockerRunner.isAvailable(), true);
  });

  it('runs a container and returns exit 0 success', async () => {
    const runner = new DockerRunner({ memory: '256m', cpus: '1.0' });
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'cat /app/hello.txt',
      dir: seedDir,
      timeout: 30000,
      network: 'none',
    });
    const result = await exec.result;
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.cancelled, false);
    assert.ok(result.duration >= 0);
  });

  it('reports non-zero exit when command fails', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'exit 3',
      timeout: 15000,
      network: 'none',
    });
    const result = await exec.result;
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 3);
  });

  it('extracts files and folders after a successful run', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-ext-'));
    try {
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'alpine:3.19',
        command:
          'mkdir -p /app/results && ' +
          'echo hello > /app/results/a.txt && ' +
          'echo world > /app/results/b.txt',
        timeout: 30000,
        network: 'none',
        extract: [
          { from: '/app/results', to: path.join(outDir, 'out') },
          { from: '/app/missing', to: path.join(outDir, 'nope') },
        ],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      assert.ok(result.extracted);
      assert.equal(result.extracted!.length, 2);
      assert.equal(result.extracted![0].status, 'ok');
      assert.equal(result.extracted![1].status, 'missing');
      assert.equal(
        fs.readFileSync(path.join(outDir, 'out', 'a.txt'), 'utf8').trim(),
        'hello',
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('kills the container when timeout elapses', async () => {
    const runner = new DockerRunner();
    const started = Date.now();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 30',
      timeout: 2000,
      network: 'none',
    });
    const result = await exec.result;
    const elapsed = Date.now() - started;
    assert.equal(result.success, false);
    assert.ok(elapsed < 15000, `expected timeout ~2s, got ${elapsed}ms`);
    assert.notEqual(result.exitCode, 0);
  });

  it('honors execution.cancel() mid-run', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 30',
      timeout: 60000,
      network: 'none',
    });
    setTimeout(() => exec.cancel(), 500);
    const result = await exec.result;
    assert.equal(result.cancelled, true);
    assert.equal(result.success, false);
  });

  it('honors an external AbortSignal', async () => {
    const runner = new DockerRunner();
    const controller = new AbortController();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'sleep 30',
      timeout: 60000,
      network: 'none',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 500);
    const result = await exec.result;
    assert.equal(result.cancelled, true);
    assert.equal(result.success, false);
  });

  it('immediately cancels when signal is already aborted', async () => {
    const runner = new DockerRunner();
    const controller = new AbortController();
    controller.abort();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo hi',
      timeout: 30000,
      network: 'none',
      signal: controller.signal,
    });
    const result = await exec.result;
    assert.equal(result.cancelled, true);
  });

  it('streams container stdout/stderr lines through onLog', async () => {
    const lines: string[] = [];
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command: 'echo alpha; echo beta 1>&2; echo gamma',
      timeout: 30000,
      network: 'none',
      onLog: (line) => lines.push(line),
    });
    await exec.result;
    assert.ok(lines.some((l) => l.includes('alpha')), `alpha not found in ${JSON.stringify(lines)}`);
    assert.ok(lines.some((l) => l.includes('beta')));
    assert.ok(lines.some((l) => l.includes('gamma')));
  });

  it('propagates env vars into the container (invalid names dropped)', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-env-'));
    try {
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'alpine:3.19',
        command: 'printf "%s|%s" "$FOO" "$BAR" > /app/env.out',
        timeout: 30000,
        network: 'none',
        env: { FOO: 'hello', BAR: 'world', 'BAD-NAME': 'should-be-dropped' },
        extract: [{ from: '/app/env.out', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      const out = fs.readFileSync(path.join(outDir, 'env.out'), 'utf8');
      assert.equal(out, 'hello|world');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('skips symlinks in seeded folder so host files cannot leak in', async () => {
    const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-link-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-link-out-'));
    try {
      fs.writeFileSync(path.join(seed, 'real.txt'), 'i am real');
      let canSymlink = true;
      try {
        fs.symlinkSync(os.tmpdir(), path.join(seed, 'host-link'), 'junction');
      } catch {
        canSymlink = false;
      }
      if (!canSymlink) {
        return;
      }
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'alpine:3.19',
        command:
          'hasLink=false; [ -L /app/host-link ] && hasLink=true; ' +
          'hasReal=false; [ -f /app/real.txt ] && hasReal=true; ' +
          'printf "%s|%s" "$hasLink" "$hasReal" > /app/probe.out',
        dir: seed,
        timeout: 30000,
        network: 'none',
        extract: [{ from: '/app/probe.out', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      const out = fs.readFileSync(path.join(outDir, 'probe.out'), 'utf8');
      assert.equal(out, 'false|true', 'symlink must be skipped, real file must be seeded');
    } finally {
      fs.rmSync(seed, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('blocks outbound traffic when network is "none"', async () => {
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'alpine:3.19',
      command:
        'if wget -q -T 3 -O /dev/null http://example.com 2>/dev/null; then exit 0; else exit 7; fi',
      timeout: 15000,
      network: 'none',
    });
    const result = await exec.result;
    assert.equal(result.exitCode, 7, 'wget should fail with network=none');
  });

  it('rejects with CONTAINER_START_FAILED on a non-existent image', async () => {
    /*
     * v0.10 behaviour: dockerode tries to pull a missing image and surfaces
     * "pull access denied / repository does not exist" as a structured
     * `LightRunnerError`. The test asserts the rejection reaches the caller
     * (no silent hang) - this used to resolve with `success: false` under
     * the docker CLI transport, which auto-pulled and exited 125.
     */
    const runner = new DockerRunner();
    const exec = runner.run({
      image: 'light-runner-nope-does-not-exist:latest',
      command: 'true',
      timeout: 15000,
      network: 'none',
    });
    await assert.rejects(
      () => exec.result,
      (err: Error & { code?: string }) =>
        err.name === 'LightRunnerError' && err.code === 'CONTAINER_START_FAILED',
    );
  });

  it('isolates concurrent runs (no cross-contamination)', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-conc-'));
    try {
      const runner = new DockerRunner();
      const make = (tag: string) =>
        runner.run({
          image: 'alpine:3.19',
          command: `printf "%s" "${tag}" > /app/tag.out`,
          timeout: 30000,
          network: 'none',
          extract: [{ from: '/app/tag.out', to: path.join(outDir, tag) }],
        });
      const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((t) => make(t).result));
      assert.equal(a.success, true);
      assert.equal(b.success, true);
      assert.equal(c.success, true);
      assert.equal(fs.readFileSync(path.join(outDir, 'A', 'tag.out'), 'utf8'), 'A');
      assert.equal(fs.readFileSync(path.join(outDir, 'B', 'tag.out'), 'utf8'), 'B');
      assert.equal(fs.readFileSync(path.join(outDir, 'C', 'tag.out'), 'utf8'), 'C');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
