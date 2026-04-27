# Quick start

Run untrusted code in a hardened Docker container, get back the exit code, logs, and any files the container produced. That is the whole library.

## Install

```bash
npm install light-runner
```

Requirements:

- Node.js >= 22
- A running Docker daemon (Docker Desktop on macOS / Windows, `dockerd` on Linux)
- Optional: [gVisor](./gvisor-kata) for kernel-level isolation

## Run something

```ts
import { DockerRunner } from 'light-runner';

const runner = new DockerRunner({ memory: '512m', cpus: '1' });

const execution = runner.run({
  image: 'python:3.12-alpine',
  command: 'python main.py',
  dir: './my-project',
  input: { task: 'compute', n: 20 },
  timeout: 30_000,
  extract: [{ from: '/app/result.json', to: './out' }],
});

const result = await execution.result;

result.success    // true if exitCode === 0, not cancelled, not timed out
result.exitCode   // container exit code
result.duration   // ms
result.cancelled  // true if cancel() / signal aborted
result.extracted  // [{ from, to, status, bytes? }, ...] if extract was set
```

## What happens under the hood

1. A named Docker volume is created (`light-runner-<uuid>`).
2. The folder at `dir` is streamed into the volume via a throwaway Alpine seeder, skipping `.git`, `node_modules`, `dist`, `build`, `.next`, `.cache`, `.turbo`, `coverage`, and **all symlinks**.
3. Your image runs with the volume mounted at `workdir` (default `/app`), strict isolation flags, and a PID / memory / CPU cap.
4. On exit-code 0, each `extract` entry is streamed out via `tar`. On non-zero exit, extract is skipped.
5. The volume is destroyed, success or not.

## Where to go next

- [Extract files](./extract) — how to pull artefacts out of the container after a run
- [Detached runs](./detached) — long-running jobs that survive a host restart
- [Security model](./security) — what the sandbox protects against and what it does not
- [gVisor & Kata](./gvisor-kata) — adding a stronger runtime for hostile code
- [API reference](/api/) — full type signatures and class methods
