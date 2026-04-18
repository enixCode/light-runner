// Manual end-to-end demo of light-runner.
//
// Usage (requires Docker Desktop / dockerd running on host):
//   npm run demo
//
// This runs a set of real containers and prints the result of each. Edit
// liberally to poke at specific behaviours; it is not part of the test suite.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DockerRunner } from '../src/index.js';

function section(title: string) {
  console.log(`\n===== ${title} =====`);
}

async function main() {
  if (!DockerRunner.isAvailable()) {
    console.error('Docker is not available on this machine. Exiting.');
    process.exit(1);
  }

  const runner = new DockerRunner({ memory: '256m', cpus: '1' });

  // ---------------------------------------------------------------------------
  section('1. hello-world shell');

  const hello = runner.run({
    image: 'alpine:3.19',
    command: 'echo "hello from inside the sandbox"',
    timeout: 15_000,
    network: 'none',
    onLog: (line) => console.log('  [container]', line),
  });
  console.log('  result:', await hello.result);

  // ---------------------------------------------------------------------------
  section('2. input over stdin, output as extracted file');

  const pyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-demo-py-'));
  const pyOut = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-demo-py-out-'));
  fs.writeFileSync(
    path.join(pyDir, 'main.py'),
    [
      'import sys, json',
      'params = json.loads(sys.stdin.read())',
      'n = int(params["n"])',
      'out = {"input": n, "square": n * n, "double": n * 2}',
      'open("result.json", "w").write(json.dumps(out))',
      '',
    ].join('\n'),
  );

  const py = runner.run({
    image: 'python:3.12-alpine',
    command: 'python main.py',
    dir: pyDir,
    input: { n: 12 },
    timeout: 30_000,
    network: 'none',
    extract: [{ from: '/app/result.json', to: pyOut }],
  });
  const pyResult = await py.result;
  console.log('  result:', pyResult);
  if (pyResult.success) {
    const data = JSON.parse(fs.readFileSync(path.join(pyOut, 'result.json'), 'utf8'));
    console.log('  parsed output:', data);
  }
  fs.rmSync(pyDir, { recursive: true, force: true });
  fs.rmSync(pyOut, { recursive: true, force: true });

  // ---------------------------------------------------------------------------
  section('3. multi-file artefact extract (Node build -> folder)');

  const nodeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-demo-node-'));
  const nodeOut = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-demo-node-out-'));
  fs.writeFileSync(
    path.join(nodeDir, 'build.js'),
    [
      "const fs = require('fs');",
      "fs.mkdirSync('dist', { recursive: true });",
      "fs.writeFileSync('dist/a.txt', 'alpha\\n');",
      "fs.writeFileSync('dist/b.txt', 'beta\\n');",
      "fs.mkdirSync('dist/logs', { recursive: true });",
      "fs.writeFileSync('dist/logs/build.log', 'step1 ok\\nstep2 ok\\n');",
      '',
    ].join('\n'),
  );

  const nd = runner.run({
    image: 'node:20-alpine',
    command: 'node build.js',
    dir: nodeDir,
    timeout: 30_000,
    network: 'none',
    extract: [{ from: '/app/dist', to: nodeOut }],
  });
  const ndResult = await nd.result;
  console.log('  result:', ndResult);
  if (ndResult.success) {
    console.log('  extracted tree:');
    for (const f of listFiles(nodeOut)) {
      console.log('   ', f);
    }
  }
  fs.rmSync(nodeDir, { recursive: true, force: true });
  fs.rmSync(nodeOut, { recursive: true, force: true });

  // ---------------------------------------------------------------------------
  section('4. timeout kills a stuck run');

  const slow = runner.run({
    image: 'alpine:3.19',
    command: 'sleep 60',
    timeout: 2_000,
    network: 'none',
  });
  console.log('  result:', await slow.result);

  // ---------------------------------------------------------------------------
  section('5. cancellation via AbortSignal');

  const controller = new AbortController();
  const cancellable = runner.run({
    image: 'alpine:3.19',
    command: 'sleep 60',
    timeout: 60_000,
    network: 'none',
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 1_000);
  console.log('  result:', await cancellable.result);

  // ---------------------------------------------------------------------------
  section('6. non-zero exit is surfaced, extract skipped');

  const failing = runner.run({
    image: 'alpine:3.19',
    command: 'echo oops > /app/data.txt && exit 9',
    timeout: 15_000,
    network: 'none',
    extract: [{ from: '/app/data.txt', to: '/tmp/should-not-appear' }],
  });
  console.log('  result:', await failing.result);

  // ---------------------------------------------------------------------------
  section('7. missing path in extract: reported, run still succeeds');

  const partial = runner.run({
    image: 'alpine:3.19',
    command: 'echo yes > /app/present.txt',
    timeout: 15_000,
    network: 'none',
    extract: [
      { from: '/app/present.txt', to: '/tmp/light-runner-demo-present' },
      { from: '/app/missing.txt', to: '/tmp/light-runner-demo-missing' },
    ],
  });
  const pr = await partial.result;
  console.log('  result:', pr);
  fs.rmSync('/tmp/light-runner-demo-present', { recursive: true, force: true });

  // ---------------------------------------------------------------------------
  section('Done.');

  DockerRunner.cleanupOrphanVolumes();
}

function listFiles(root: string, rel = ''): string[] {
  const here = path.join(root, rel);
  if (!fs.existsSync(here)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(here, { withFileTypes: true })) {
    const p = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(root, p));
    else out.push(p);
  }
  return out;
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
