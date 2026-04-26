import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { DockerRunner } from '../../src/DockerRunner.js';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

const IMG = 'alpine:3.19';

maybe('e2e limits + admin', () => {
  it('default ignores skip .git and node_modules from seeded folder', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-ignores-'));
    try {
      fs.mkdirSync(path.join(dir, '.git'));
      fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg.json'), '{}');
      fs.writeFileSync(path.join(dir, 'src.txt'), 'kept\n');

      const lines: string[] = [];
      const runner = new DockerRunner();
      const result = await runner.run({
        image: IMG,
        command: 'ls -1',
        dir,
        timeout: 30_000,
        onLog: (l) => lines.push(l),
      }).result;

      assert.equal(result.exitCode, 0);
      assert.ok(lines.includes('src.txt'), 'src.txt should be seeded');
      assert.ok(!lines.includes('.git'), '.git must be ignored');
      assert.ok(!lines.includes('node_modules'), 'node_modules must be ignored');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('default isolated bridge allows outbound internet', async () => {
    const lines: string[] = [];
    const runner = new DockerRunner();
    const result = await runner.run({
      image: IMG,
      command: 'wget -T 5 -q -O - https://example.com 2>/dev/null | head -c 30; echo; echo exit=$?',
      timeout: 30_000,
      onLog: (l) => lines.push(l),
    }).result;

    assert.equal(result.exitCode, 0);
    assert.ok(
      lines.some((l) => l === 'exit=0'),
      `expected wget to succeed on the default network, got lines: ${JSON.stringify(lines)}`,
    );
  });

  it('memory cap OOM-kills a heap-allocating process', async () => {
    const tinyRunner = new DockerRunner({ memory: '20m' });
    // awk grows a single heap string. 60 MiB target with a 20 MiB cgroup cap
    // forces an OOM before the loop completes. Heap allocations are accounted
    // by every cgroup driver we care about, including Docker Desktop on
    // Windows where /dev/shm tmpfs accounting can leak past the limit.
    const result = await tinyRunner.run({
      image: IMG,
      command: `awk 'BEGIN{a=""; for(i=0;i<60;i++){a = a sprintf("%*s", 1024*1024, "x")} print length(a)}'`,
      timeout: 15_000,
    }).result;

    assert.notEqual(
      result.exitCode,
      0,
      `memory cap should kill the awk allocation, got clean exit ${result.exitCode}`,
    );
  });

  it('CAP_NET_RAW is dropped: opening SOCK_RAW fails with EPERM', async () => {
    // busybox `ping` uses ICMP datagram sockets (SOCK_DGRAM) which the kernel
    // permits without CAP_NET_RAW via net.ipv4.ping_group_range, so it cannot
    // prove the cap is dropped. Python's socket(AF_INET, SOCK_RAW, ...) goes
    // through the SOCK_RAW path and is denied by the kernel without NET_RAW.
    const lines: string[] = [];
    const runner = new DockerRunner();
    const result = await runner.run({
      image: 'python:3.12-alpine',
      command:
        `python -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP); s.close(); print('HAS_NET_RAW')" 2>&1; echo exit=$?`,
      timeout: 60_000,
      onLog: (l) => lines.push(l),
    }).result;

    // The outer sh exits 0 because of `; echo exit=$?`. The inner python is
    // expected to exit non-zero with a PermissionError.
    assert.equal(result.exitCode, 0);
    assert.ok(
      !lines.includes('HAS_NET_RAW'),
      `SOCK_RAW must be denied; got HAS_NET_RAW in output: ${JSON.stringify(lines)}`,
    );
    const exitLine = lines.find((l) => l.startsWith('exit='));
    assert.ok(
      exitLine && exitLine !== 'exit=0',
      `python should have failed; got ${exitLine}`,
    );
    assert.ok(
      lines.some((l) => /PermissionError|Operation not permitted|EPERM/i.test(l)),
      `expected permission error in output, got: ${JSON.stringify(lines)}`,
    );
  });

  it('cleanupOrphanVolumes removes a labeled orphan volume', async () => {
    const dk = new Docker();
    const orphanName = `light-runner-orphan-${Date.now()}`;

    await dk.createVolume({
      Name: orphanName,
      Labels: { 'light-runner.run-id': orphanName },
    });

    let removedCount = 0;
    try {
      removedCount = await DockerRunner.cleanupOrphanVolumes();
    } catch (err) {
      try { await dk.getVolume(orphanName).remove({ force: true }); } catch { /* swallow */ }
      throw err;
    }

    let stillExists = true;
    try {
      await dk.getVolume(orphanName).inspect();
    } catch {
      stillExists = false;
    }

    if (stillExists) {
      try { await dk.getVolume(orphanName).remove({ force: true }); } catch { /* swallow */ }
    }

    assert.equal(stillExists, false, 'orphan volume should be removed by cleanupOrphanVolumes');
    assert.ok(removedCount >= 1, `cleanup should report at least one removed volume, got ${removedCount}`);
  });
});
