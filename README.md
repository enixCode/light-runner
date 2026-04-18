<p align="center">
  <img src="docs/banner.webp" alt="light-runner banner" width="720" />
</p>

<h1 align="center">light-runner</h1>

<p align="center">
  <b>Run untrusted code in hardened Docker containers from Node.js.</b><br>
  Domain-agnostic: exit code, logs, extracted files. Nothing else.
</p>

<p align="center">
  <a href="https://enixcode.github.io/light-runner/">Website</a> -
  <a href="#install">Install</a> -
  <a href="#quick-start">Quick start</a> -
  <a href="#extract">Extract</a> -
  <a href="#security-model">Security</a> -
  <a href="#roadmap">Roadmap</a> -
  <a href="#testing">Testing</a>
</p>

---

## Ecosystem

`light-runner` is the **execution primitive** in a family of small, composable tools. Each project does one thing and hands off the rest.

| Project         | Responsibility                                 | Status       |
| --------------- | ---------------------------------------------- | ------------ |
| `light-runner`  | Spawn one container, return exit code + files  | **this repo** |
| `light-run`     | CLI + HTTP wrapper around `light-runner`       | planned      |
| `light-process` | DAG orchestration, retries, fan-out            | planned      |

Each layer is an independent npm package. Use `light-runner` alone when you just need to run code in a sandbox; pick the higher layers when you want scheduling or an HTTP surface.

---

## Install

```bash
npm install light-runner
```

**Requirements**

- Node.js >= 20
- A running Docker daemon (Docker Desktop on macOS/Windows, `dockerd` on Linux)
- Optional: [gVisor (`runsc`)](#gvisor-hardening) for kernel isolation

---

## Quick start

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
result.cancelled  // true if cancel() / abort signal
result.extracted  // [{ from, to, status, bytes? }, ...] if extract was set
```

Need structured output back? Have the container **write a file** and `extract` it:

```ts
// Inside the container:
fs.writeFileSync('/app/result.json', JSON.stringify({ fib: 6765 }))

// On the host:
const result = await execution.result;
const data = JSON.parse(fs.readFileSync('./out/result.json', 'utf8'));
```

Your container writes whatever files it wants, you pull them out.

What happens under the hood:

1. A named Docker volume is created (`light-runner-<uuid>`).
2. The folder at `dir` is streamed into the volume via a throwaway Alpine seeder, skipping `.git`, `node_modules`, `dist`, `build`, `.next`, `.cache`, `.turbo`, `coverage`, and **all symlinks**.
3. Your image runs with the volume mounted at `workdir` (default `/app`), strict isolation flags, and a PID / memory / CPU cap.
4. On exit-code 0, each `extract` entry is streamed out via `tar`. On non-zero exit, extract is skipped.
5. The volume is destroyed, success or not.

---

## Extract

Extract is the **only output channel** for files. It streams disk-to-disk via `tar`, never buffering in Node RAM.

```ts
extract: [
  { from: '/app/dist',       to: './out' },  // folder, recursive
  { from: '/app/report.pdf', to: './out' },  // single file
  { from: '/app/nope',       to: './out' },  // missing -> reported, run still succeeds
]
```

### Folder vs. file semantics (rsync-like)

- **Folder `from`**: the **contents** of the folder land **directly in `to`** (no basename wrap). Equivalent to `rsync -a from/ to/` or `cp -r from/. to/`. All subdirectories and files are included recursively.
- **File `from`**: the file lands as `to/basename(from)`.
- `to` is always a **destination directory**, auto-created via `fs.mkdirSync(to, { recursive: true })`.
- Symlinks encountered during extract are **skipped** (security - a malicious container could craft a symlink whose target path exists on the host).
- Per-entry cap: **1 GiB**. Above that, the entry is reported as `error`, the run still succeeds.
- Extract only runs if `exitCode === 0` and the run was not cancelled. Failed runs leave `extracted` undefined.

Example:

```ts
extract: [
  { from: '/app/dist',    to: './out' },  // /app/dist/a.js -> ./out/a.js
  { from: '/app/dist/',   to: './out' },  // trailing slash, same result
  { from: '/app/report.pdf', to: './out' }, // -> ./out/report.pdf
]
```

### Result

Each `extract` entry produces one `ExtractResult`:

| `status`    | meaning                                             |
| ----------- | --------------------------------------------------- |
| `'ok'`      | archived and extracted. `bytes` = archive size.     |
| `'missing'` | `from` does not exist in the container              |
| `'error'`   | cap exceeded, path traversal, collision, etc.       |

A missing or errored entry never fails the run - the consumer inspects `result.extracted` and decides what to do.

---

## API

```ts
class DockerRunner {
  constructor(options?: RunnerOptions);
  run(request: RunRequest): Execution;
  static isAvailable(): boolean;
  static cleanupOrphanVolumes(): number;
}

class Execution {
  readonly id: string;
  readonly result: Promise<RunResult>;
  cancel(): void;
  get cancelled(): boolean;
}
```

Full type signatures live in [src/types.ts](src/types.ts).

### `RunRequest`

| field     | meaning                                                |
| --------- | ------------------------------------------------------ |
| `image`   | Docker image reference (required)                      |
| `command` | shell command to run via `sh -c`                       |
| `dir`     | host folder copied into the container workdir          |
| `input`   | any JSON value, piped to container stdin               |
| `timeout` | ms before the container is SIGKILLed (default 20 min)  |
| `network` | `'none'`, `undefined` = isolated bridge, or named net  |
| `env`     | `Record<string, string>` (invalid POSIX names dropped) |
| `workdir` | default `/app`                                         |
| `signal`  | optional `AbortSignal` to cancel the run               |
| `onLog`   | callback fired per stdout/stderr line                  |
| `extract` | `ExtractSpec[]` - pull files/folders out after success |

### `RunResult`

| field       | meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| `success`   | `exitCode === 0 && !cancelled && !timedOut`                      |
| `exitCode`  | container exit code                                              |
| `duration`  | milliseconds                                                     |
| `cancelled` | `true` if `cancel()` called or `signal` aborted                  |
| `extracted` | `ExtractResult[]`, present only if `extract` was passed          |

### `RunnerOptions`

| field               | default  | meaning                                         |
| ------------------- | -------- | ----------------------------------------------- |
| `memory`            | `512m`   | `--memory` value (cgroup hard cap)              |
| `cpus`              | `1`      | `--cpus` value (scheduler share)                |
| `runtime`           | `runc`   | `runc` \| `runsc` (gVisor) \| `kata`            |
| `gpus`              | -        | `'all' \| number \| string`, shell-safe checked |
| `noNewPrivileges`   | `true`   | apply `--security-opt no-new-privileges`        |

---

## Security model

Defaults (always on - never opt-out):

- **Capabilities dropped**: `NET_RAW`, `MKNOD`, `SYS_CHROOT`, `SETPCAP`, `SETFCAP`, `AUDIT_WRITE`
- **`--security-opt no-new-privileges`** - no setuid escalation inside the container
- **`--pids-limit 100`** - fork-bomb protection
- **`--memory 512m` / `--cpus 1`** by default - cgroup-enforced, tunable via `RunnerOptions`
- **Isolated bridge network** by default, with inter-container ICC disabled; `'none'` fully disconnects
- **Symlinks in `dir` are filtered out** at seed time - a host link cannot appear in the container
- **Path traversal in `extract`** (`..`) is rejected before any container spawns
- **Extract cap** - 1 GiB per entry, enforced container-side via `du -sb` and streaming byte-count

**What this doesn't cover**: kernel exploits, `runc` CVEs, side-channel attacks. For genuinely hostile code, combine with the gVisor runtime.

### Secrets

`env` vars go to `docker run --env`, which makes them visible in `docker inspect` and Docker metadata. That's fine in most setups (Docker socket access is already root-equivalent on the host), but for sensitive material prefer:

- **`input`** (stdin) - ephemeral, not in metadata, not in `docker inspect`. Your container reads it via `sys.stdin.read()` / `process.stdin`.
- **A bind mount to `/run/secrets/<name>`** - the Docker-native file-based secrets pattern (compose has a `secrets:` block for this). Not managed by light-runner, the consumer wires it.

### gVisor hardening

gVisor (`runsc`) intercepts syscalls in user-space and presents a much smaller attack surface than sharing the host kernel. Trade-off: ~10-30% slower on I/O.

Install on Linux / WSL2 (gVisor does not run natively on macOS or Windows; use the WSL2 backend of Docker Desktop):

```bash
(
  set -e
  ARCH=$(uname -m)
  URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}
  wget ${URL}/runsc ${URL}/runsc.sha512 \
       ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512
  sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
  rm -f *.sha512
  chmod a+rx runsc containerd-shim-runsc-v1
  sudo mv runsc containerd-shim-runsc-v1 /usr/local/bin
)
sudo /usr/local/bin/runsc install
sudo systemctl reload docker
```

`latest` is a rolling channel - gVisor ships frequent date-stamped releases (`release-YYYYMMDD.N`), no semantic version. Check the current pointer with `runsc --version` after install.

Then:

```ts
const runner = new DockerRunner({ runtime: 'runsc' });
```

---

## Project layout

```
light-runner/
  src/
    index.ts           public exports
    DockerRunner.ts    main class + execution orchestration
    Execution.ts       cancellable handle
    types.ts           RunRequest, RunResult, ExtractSpec, ...
    args.ts            pure docker args builder
    volume.ts          create / seed / extract / destroy
    constants.ts       caps, limits, names, regexes
  test/
    unit/
      args.test.ts         (18 tests, pure)
    e2e/                   (Docker required)
      volume.test.ts
      runner.test.ts       (lifecycle, cancel, timeout, adversarial)
      realworld.test.ts    (real Python/Node code + artefact extract)
  Dockerfile.test          test harness image
  docker-compose.test.yml  sibling-container test runner
  dist/                    compiled output (gitignored, npm-published)
```

---

## Testing

```bash
npm run test:unit    # no Docker, <500ms
npm run test:e2e     # Docker required
npm test             # all
npm run test:docker  # all, inside a disposable container (see below)
```

### Running the full suite in a container

`npm run test:docker` uses [docker-compose.test.yml](docker-compose.test.yml) to spin up `node:22-alpine` + `docker-cli`, bind-mount the repo, and mount the host Docker socket. The test container talks to the host daemon; spawned containers land as **siblings** on the host, not nested (no Docker-in-Docker, no nested daemon).

```bash
npm run test:docker
```

Prerequisites:
- Docker + `docker compose` plugin on the host
- On Windows, Docker Desktop with WSL2 backend

---

## Roadmap

- **Detached / pause / resume**: survive host process restarts, reattach by id, pause + resume a running container.
- **Folder `ignore` option**: extend the hardcoded excludes when seeding a directory.
- **Override the 1 GiB extract cap** via `RunnerOptions.maxExtractBytes`.

Roadmap items are not public API and are subject to change.

---

## Publishing

```bash
npm version patch   # or minor / major
npm publish         # prepublishOnly -> build
```

Only `dist/`, `README.md`, and `LICENSE` ship, per [.npmignore](.npmignore).

---

## License

[AGPL-3.0](LICENSE)
