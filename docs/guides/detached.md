# Detached runs

A standard `runner.run(...)` ties the container's lifetime to the host Node process: kill the host, the run dies. Detached mode lets the container outlive the host.

Use it when:

- A run can take **hours** (training, batch jobs, CI-like workloads) and you cannot afford to lose it on a host crash or deploy.
- You want a long-poll architecture where one process **starts** runs and a different process **collects** results.
- You want to spawn a job, return immediately, and reconnect later from anywhere on the same machine.

## Start a detached run

```ts
import { DockerRunner } from 'light-runner';

const runner = new DockerRunner();

const execution = runner.run({
  image: 'python:3.12-alpine',
  command: 'python long_job.py',
  dir: './job',
  timeout: 6 * 60 * 60 * 1000,  // 6 hours
  extract: [{ from: '/app/result.json', to: './out' }],
  detached: true,
});

console.log('started, id =', execution.id);
// you can let this process exit; the container keeps running
```

## Reconnect to a running detached job

```ts
const ex = DockerRunner.attach('light-runner-abc123def456');
if (!ex) {
  console.error('no state file for that id');
} else {
  const result = await ex.result;
  console.log(result.success, result.exitCode, result.extracted);
}
```

`attach(id)` returns `null` when no state file exists for that id (typo'd id, or the run was reaped).

## Listing known runs

```ts
import { DockerRunner } from 'light-runner';

for (const state of DockerRunner.list()) {
  console.log(state.id, state.status, state.startedAt, state.image);
}
```

## Detached contract differences

| Capability | Attached | Detached |
|---|---|---|
| `input` (stdin) | Supported | **Rejected at API boundary** (host process death loses stdin) |
| `onLog` callback | Streams stdout/stderr lines | **Not called** (stream lost on host death; use `docker logs <id>` instead) |
| `cancel()` / signal | Best-effort kill | Best-effort kill, plus state file marked `cancelled` |
| `extract` | Runs after exit | Runs after exit, requested set persisted in state file |

## State file lifecycle

Every detached run writes one JSON file under `~/.light-runner/state/<id>.json` (or `LIGHT_RUNNER_STATE_DIR`):

```jsonc
{
  "id":         "light-runner-abc123def456",
  "container":  "light-runner-abc123def456",
  "volume":     "light-runner-abc123def456",
  "image":      "python:3.12-alpine",
  "workdir":    "/app",
  "command":    "python long_job.py",
  "timeout":    21600000,
  "extract":    [{"from": "/app/result.json", "to": "./out"}],
  "startedAt":  "2026-04-27T10:15:00.000Z",
  "status":     "running"
}
```

Status transitions:

```
running ──┬─> exited     (clean exit, exitCode + finishedAt + durationMs added)
          ├─> cancelled  (cancel() / abort, exitCode set, cancelled: true)
          └─> failed     (setup error, container vanished, etc.)
```

Writes are atomic via temp + rename, so a host crash mid-write does not corrupt the file.

## Cross-host resume

The state dir is just JSON files under a fixed path. Two ways to make it shared:

1. **Same machine, different process trees**: same `LIGHT_RUNNER_STATE_DIR`, no extra setup. Process A starts the run, process B re-attaches by id.
2. **Different machines**: mount the state dir on a shared filesystem (NFS, EFS, networked volume). The Docker daemon must be the **same one** on both hosts (they share the named volume + container by name).

## Race-safe attach

`attach(id)` is safe to call **immediately after** `runner.run({detached: true})` returns. The runner writes the state file synchronously inside `run()`, before any async setup, so the file always exists by the time the caller has the `Execution` handle. Internally, `attach` polls the docker daemon for ~3 seconds with `containerExists()` to absorb the gap between state-file-written and container-actually-created.

## Reaping

A long-running host eventually accumulates state files for finished runs. Two cleanup helpers:

```ts
// Reconcile state files with the docker daemon.
// Mark `running` states as `failed` if their container has vanished.
await DockerRunner.cleanupOrphanStates();

// Sweep idle/exited containers + volumes tagged with the light-runner label.
const { containers, volumes } = await DockerRunner.reapOrphans();
console.log(`reaped ${containers} containers, ${volumes} volumes`);
```

`reapOrphans` removes resources older than `LIGHT_RUNNER_REAP_AGE_MS` (default 5 minutes). Safe to run on a shared docker host with unrelated workloads since it filters by the `light-runner.run-id` label.

Run both on host startup, before accepting new work.

## Stop, pause, resume

Detached or attached, the same `Execution` API works:

```ts
await ex.stop({ signal: 'SIGTERM', grace: 10_000 });  // graceful, fall back to SIGKILL
await ex.pause();   // freezes via cgroup, memory preserved
await ex.resume();  // unfreezes
ex.cancel();        // immediate kill, sync, fire-and-forget
```

`pause()` is intentionally not flagging `cancelled: true` — a paused run is expected to resume and complete normally.

## Gotchas

- **Stdin is gone.** `RunRequest.input` is rejected at the API boundary when `detached: true`. Pipe input through a file in `dir` instead.
- **`onLog` is silent.** No live stream on host. Inspect `docker logs <container-name>` for stdout/stderr while the run is alive.
- **State file ≠ source of truth for liveness.** A `running` status with a vanished container = ghost run; `cleanupOrphanStates` is what reconciles that.
- **Extract still runs**, but only when the host that holds the resolved promise sees the exit. Re-attached hosts see `extracted` in their `result` too.
