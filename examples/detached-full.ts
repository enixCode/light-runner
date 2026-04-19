// Manual end-to-end demo of detached mode + attach + list + stop + pause/resume.
// Run: npm run demo:detached   (adds after test:build)
// Docker required. Uses a per-run isolated STATE_DIR to avoid clashes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the state dir for this demo so it doesn't mix with real runs.
const demoStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-detached-demo-'));
process.env.LIGHT_RUNNER_STATE_DIR = demoStateDir;

const { DockerRunner } = await import('../src/DockerRunner.js');
const { listStates, readState } = await import('../src/state.js');

function h(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + title);
  console.log('='.repeat(70));
}

function line(...parts: unknown[]) {
  console.log(' ', ...parts);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

if (!DockerRunner.isAvailable()) {
  console.error('Docker not available. Start Docker Desktop / dockerd first.');
  process.exit(1);
}

console.log('\nDemo state dir:', demoStateDir);

// ---------------------------------------------------------------------------
h('1. Detached run - the most basic flow');

{
  const runner = new DockerRunner({ memory: '256m', cpus: '0.5' });
  const exec = runner.run({
    image: 'alpine:3.19',
    command: 'echo "hello from a detached container"',
    network: 'none',
    timeout: 30_000,
    detached: true,
  });
  line('exec.id =', exec.id);
  line('waiting for container to exit...');
  const result = await exec.result;
  line('result:', result);

  const state = readState(exec.id);
  line('state file after completion:');
  line(JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
h('2. Detached with extract - python script writes a file, we pull it out');

{
  const runner = new DockerRunner();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-demo-py-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-demo-py-out-'));
  try {
    fs.writeFileSync(
      path.join(workDir, 'main.py'),
      [
        'import json',
        'print("running python", flush=True)',
        'with open("result.json", "w") as f:',
        '    json.dump({"computed": 42, "pi": 3.14}, f)',
        '',
      ].join('\n'),
    );
    const exec = runner.run({
      image: 'python:3.12-alpine',
      command: 'python main.py',
      dir: workDir,
      timeout: 60_000,
      network: 'none',
      detached: true,
      extract: [{ from: '/app/result.json', to: outDir }],
    });
    line('exec.id =', exec.id);
    const result = await exec.result;
    line('result:', result);

    const extracted = fs.readFileSync(path.join(outDir, 'result.json'), 'utf8');
    line('extracted file content:', extracted);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
h('3. Attach - a second handle picks up a live detached run');

{
  const runner = new DockerRunner();
  const exec = runner.run({
    image: 'alpine:3.19',
    command: 'sleep 3 && echo "attached finished"',
    network: 'none',
    timeout: 30_000,
    detached: true,
  });
  line('exec.id =', exec.id);

  // Wait a moment for the state file to land.
  let attached: ReturnType<typeof DockerRunner.attach> = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const s = readState(exec.id);
    if (s && s.status === 'running') {
      attached = DockerRunner.attach(exec.id);
      if (attached) break;
    }
    await sleep(100);
  }
  if (!attached) {
    line('WARN: could not attach in time');
  } else {
    line('attached handle id =', attached.id);
    line('both handles will resolve when the container exits...');
    const [original, reattach] = await Promise.all([exec.result, attached.result]);
    line('original result:', original);
    line('reattached result:', reattach);
  }
}

// ---------------------------------------------------------------------------
h('4. List - enumerate every state file we know about');

{
  const states = DockerRunner.list();
  line(`found ${states.length} state file(s)`);
  for (const s of states) {
    line(`  - ${s.id}: ${s.status} (exit=${s.exitCode ?? 'n/a'}, image=${s.image})`);
  }
}

// ---------------------------------------------------------------------------
h('5. cleanupOrphanStates - fix ghost "running" states with no container');

{
  // Inject a fake state claiming a container is running that does not exist.
  const ghostId = 'light-runner-ghost-demo';
  const { writeState } = await import('../src/state.js');
  writeState({
    id: ghostId,
    container: 'light-runner-does-not-exist-ever',
    volume: 'light-runner-does-not-exist-ever',
    image: 'alpine:3.19',
    workdir: '/app',
    startedAt: new Date().toISOString(),
    status: 'running',
  });
  line('injected ghost state:', ghostId);

  const before = readState(ghostId);
  line('before cleanup: status =', before?.status);

  const fixed = DockerRunner.cleanupOrphanStates();
  line('cleanupOrphanStates() fixed', fixed, 'state(s)');

  const after = readState(ghostId);
  line('after cleanup: status =', after?.status);
}

// ---------------------------------------------------------------------------
h('6. Graceful stop - SIGTERM, then SIGKILL after grace period');

{
  const runner = new DockerRunner();
  // A trap catches SIGTERM and exits 130 after a quick cleanup message.
  const exec = runner.run({
    image: 'alpine:3.19',
    command:
      'trap "echo got-SIGTERM-cleaning-up; exit 130" TERM; ' +
      'while true; do sleep 1; done',
    network: 'none',
    timeout: 60_000,
    detached: true,
  });
  line('exec.id =', exec.id);
  line('letting it run for 2s...');
  await sleep(2_000);

  line('calling stop({ signal: "SIGTERM", grace: 5000 })');
  const stopPromise = exec.stop({ signal: 'SIGTERM', grace: 5_000 });
  const result = await exec.result;
  await stopPromise;
  line('result:', result);
  line('cancelled =', exec.cancelled);
}

// ---------------------------------------------------------------------------
h('7. Pause / resume - freeze at cgroup level, then continue');

{
  const runner = new DockerRunner();
  const exec = runner.run({
    image: 'alpine:3.19',
    command:
      'i=0; while [ $i -lt 5 ]; do echo "tick $i"; i=$((i+1)); sleep 1; done',
    network: 'none',
    timeout: 60_000,
    detached: true,
  });
  line('exec.id =', exec.id);
  line('letting it run for 1.5s (should print ~2 ticks)...');
  await sleep(1_500);

  line('pausing container...');
  exec.pause();
  line('paused. sleeping host for 3s (container should be frozen)...');
  await sleep(3_000);

  line('resuming container...');
  exec.resume();
  line('resumed. waiting for run to complete...');
  const result = await exec.result;
  line('result:', result);
  line('(container ran longer than 5s wall-clock because of the pause)');
}

// ---------------------------------------------------------------------------
h('8. Cleanup demo state dir');

fs.rmSync(demoStateDir, { recursive: true, force: true });
line('removed', demoStateDir);

console.log('\nDONE.\n');
