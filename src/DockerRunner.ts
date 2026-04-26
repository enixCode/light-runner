import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { Duplex } from 'node:stream';
import type Dockerode from 'dockerode';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WORKDIR,
  ISOLATED_NETWORK,
  RUN_ID_LABEL,
  VOLUME_PREFIX,
  reapAgeMs,
} from './constants.js';
import { buildContainerCreateOptions } from './createOptions.js';
import { docker, pingDaemon } from './docker.js';
import { LightRunnerError } from './errors.js';
import { Execution } from './Execution.js';
import { listStates, readState, updateState, writeState } from './state.js';
import type { RunState } from './state.js';
import { cleanupOrphanVolumes, createVolume, destroyVolume } from './volume/index.js';
import { seedVolume } from './volume/seed.js';
import { extractFromVolume } from './volume/extract.js';
import type { ExtractResult, RunnerOptions, RunRequest, RunResult } from './types.js';

interface ExecuteCtx {
  request: RunRequest;
  /*
   * Shared name for the per-run container and volume. The library names both
   * after `${VOLUME_PREFIX}<shortId>` so reapOrphans + cleanupOrphanVolumes
   * can find them with the same prefix scan.
   */
  name: string;
  workdir: string;
  network: string | undefined;
}

export class DockerRunner {
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = options;
  }

  /*
   * Synchronous handle, asynchronous result. We do not pre-flight the daemon
   * here because the call must stay sync - the ping happens at the start of
   * the inner async work and any DOCKER_UNREACHABLE error reaches the
   * caller via `execution.result`.
   */
  run(request: RunRequest): Execution {
    const workdir = request.workdir ?? DEFAULT_WORKDIR;
    validateRequest(request);

    const execId = randomUUID();
    const name = `${VOLUME_PREFIX}${execId.slice(0, 12)}`;

    const ctx: ExecuteCtx = {
      request,
      name,
      workdir,
      network: request.network,
    };

    const state: RunState_ = { cancelled: false, container: null };
    const result = request.detached
      ? this.executeDetached(ctx, state)
      : this.execute(ctx, state);

    const execution = new Execution(name, result, () => {
      state.cancelled = true;
      // Best-effort kill: the container may not exist yet (still creating)
      // or may already be gone. Fire-and-forget either way. For detached
      // runs the local `state.container` reference may be missing (state
      // file lives across processes), so we look up by name as a fallback.
      const target = state.container ?? docker.getContainer(name);
      target.kill().catch(() => { /* swallow */ });
    });

    if (request.signal) {
      if (request.signal.aborted) execution.cancel();
      else request.signal.addEventListener('abort', () => execution.cancel(), { once: true });
    }

    return execution;
  }

  private async execute(ctx: ExecuteCtx, state: RunState_): Promise<RunResult> {
    const { request, name, workdir } = ctx;
    const started = Date.now();

    let volumeCreated = false;
    try {
      await this.setupContainer(ctx, state, false);
      volumeCreated = true;

      const inner = await runContainer(state.container!, request, state);

      let extracted: ExtractResult[] | undefined;
      if (request.extract?.length && inner.exitCode === 0 && !state.cancelled) {
        extracted = await extractFromVolume(name, workdir, request.extract);
      }

      const duration = Date.now() - started;
      const success = inner.exitCode === 0 && !state.cancelled && !inner.timedOut;

      return {
        success,
        exitCode: inner.exitCode,
        duration,
        cancelled: state.cancelled,
        ...(extracted ? { extracted } : {}),
      };
    } finally {
      if (volumeCreated) await destroyVolume(name);
    }
  }

  private async executeDetached(ctx: ExecuteCtx, state: RunState_): Promise<RunResult> {
    const { request, name, workdir } = ctx;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    let volumeCreated = false;
    let containerStarted = false;

    // Persist the state file BEFORE setupContainer + start so a caller that
    // re-enters with `DockerRunner.attach(execution.id)` immediately after
    // `runner.run({ detached: true })` finds a state to attach to. Without
    // this, the file appears only after the async setup completes and a fast
    // re-attach races to null.
    writeState({
      id: name,
      container: name,
      volume: name,
      image: request.image,
      workdir,
      command: request.command,
      timeout: request.timeout,
      extract: request.extract,
      startedAt,
      status: 'running',
    });

    try {
      await this.setupContainer(ctx, state, true);
      volumeCreated = true;

      try {
        await state.container!.start();
      } catch (err) {
        throw new LightRunnerError({
          code: 'CONTAINER_START_FAILED',
          message: `detached start failed: ${(err as Error).message}`,
          dockerOp: 'start',
          containerId: name,
          cause: err,
        });
      }
      containerStarted = true;

      const wait = (await state.container!.wait()) as { StatusCode: number };
      const exitCode = wait.StatusCode;
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - started;

      let extracted: ExtractResult[] | undefined;
      if (request.extract?.length && exitCode === 0 && !state.cancelled) {
        extracted = await extractFromVolume(name, workdir, request.extract);
      }

      const success = exitCode === 0 && !state.cancelled;

      updateState(name, {
        status: state.cancelled ? 'cancelled' : 'exited',
        cancelled: state.cancelled,
        exitCode,
        finishedAt,
        durationMs,
      });

      return {
        success,
        exitCode,
        duration: durationMs,
        cancelled: state.cancelled,
        ...(extracted ? { extracted } : {}),
      };
    } catch (err) {
      updateState(name, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
      throw err;
    } finally {
      if (containerStarted) {
        // Detached runs disable AutoRemove (so wait() can read the exit
        // code), so the container survives until we explicitly remove it.
        await docker.getContainer(name).remove({ force: true }).catch(() => { /* swallow */ });
      }
      if (volumeCreated) await destroyVolume(name);
    }
  }

  private async setupContainer(ctx: ExecuteCtx, state: RunState_, detached: boolean): Promise<void> {
    const { request, name, workdir, network } = ctx;

    await pingDaemon();
    await createVolume(name, name);
    await seedVolume(name, { dir: request.dir, workdir });
    if (network === undefined || network === '') await ensureIsolatedNetwork();

    const createOpts = buildContainerCreateOptions({
      request,
      options: this.options,
      containerName: name,
      volumeName: name,
      workdir,
      runId: name,
      detached,
    });

    try {
      state.container = await docker.createContainer(createOpts);
    } catch (err) {
      throw new LightRunnerError({
        code: 'CONTAINER_START_FAILED',
        message: `createContainer failed: ${(err as Error).message}`,
        dockerOp: 'createContainer',
        containerId: name,
        cause: err,
      });
    }
  }

  static async isAvailable(): Promise<boolean> {
    try {
      await pingDaemon(2_000);
      return true;
    } catch {
      return false;
    }
  }

  static async cleanupOrphanVolumes(): Promise<number> {
    return cleanupOrphanVolumes();
  }

  /*
   * Re-attach to a previously-started detached run by id. Returns an
   * Execution whose `.result` resolves the same way as the original call did,
   * or null if no state file exists for that id.
   */
  static attach(id: string): Execution | null {
    const state = readState(id);
    if (!state) return null;

    if (state.status !== 'running') {
      // Already terminal: build a resolved Execution from the state file.
      const resolved: RunResult = {
        success: state.status === 'exited' && !state.cancelled && state.exitCode === 0,
        exitCode: state.exitCode ?? -1,
        duration: state.durationMs ?? 0,
        cancelled: state.cancelled === true,
      };
      return new Execution(id, Promise.resolve(resolved), () => { /* no-op */ });
    }

    // Running. Check the container still exists before waiting - a state
    // file claiming `running` plus a missing container is a ghost we mark
    // as failed immediately.
    const cancelState: RunState_ = { cancelled: false, container: null };
    const started = Date.parse(state.startedAt);

    const result = (async (): Promise<RunResult> => {
      // The state file is written synchronously by run() before the async
      // setup creates the container, so a fast re-attach can land in the
      // gap. Poll briefly to absorb that race instead of declaring failure.
      const exists = await waitForContainer(state.container, 3_000);
      if (!exists) {
        updateState(id, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
        });
        return { success: false, exitCode: -1, duration: 0, cancelled: false };
      }

      try {
        const container = docker.getContainer(state.container);
        cancelState.container = container;

        // condition: 'next-exit' is required because attach() can land while
        // the container is still in 'created' state (state file is written
        // sync in run() before the async start completes). The default
        // 'not-running' condition is satisfied by 'created' too, so wait()
        // would return StatusCode 0 immediately, then our finally would
        // force-remove the container under the launcher's feet.
        const wait = (await container.wait({ condition: 'next-exit' })) as { StatusCode: number };
        const exitCode = wait.StatusCode;
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - (Number.isFinite(started) ? started : Date.now());

        let extracted: ExtractResult[] | undefined;
        if (state.extract?.length && exitCode === 0 && !cancelState.cancelled) {
          extracted = await extractFromVolume(state.volume, state.workdir, state.extract);
        }

        updateState(id, {
          status: cancelState.cancelled ? 'cancelled' : 'exited',
          cancelled: cancelState.cancelled,
          exitCode,
          finishedAt,
          durationMs,
        });

        return {
          success: exitCode === 0 && !cancelState.cancelled,
          exitCode,
          duration: durationMs,
          cancelled: cancelState.cancelled,
          ...(extracted ? { extracted } : {}),
        };
      } finally {
        // Best-effort cleanup. The original run may have removed the
        // container already; ignore conflicts.
        await docker.getContainer(state.container).remove({ force: true }).catch(() => {});
        await destroyVolume(state.volume);
      }
    })();

    return new Execution(id, result, () => {
      cancelState.cancelled = true;
      docker.getContainer(state.container).kill().catch(() => { /* swallow */ });
    });
  }

  static list(): RunState[] {
    return listStates();
  }

  /*
   * Reconcile state files with the docker daemon. For every state marked
   * `running`, check the container exists. If not, mark it `failed`. Returns
   * the number of states updated. Should be called on host startup before
   * accepting new work.
   */
  static async cleanupOrphanStates(): Promise<number> {
    const states = listStates();
    let fixed = 0;
    for (const s of states) {
      if (s.status !== 'running') continue;
      if (await containerExists(s.container)) continue;
      updateState(s.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
      fixed++;
    }
    return fixed;
  }

  /*
   * Sweep stale containers + volumes left behind by crashed hosts. We only
   * touch resources stamped with our `RUN_ID_LABEL`, so this is safe to run
   * on shared docker hosts that also serve unrelated workloads. Containers
   * are reaped once they stop running for `reapAgeMs()` ms; volumes are
   * removed without `force` so still-mounted ones survive.
   */
  static async reapOrphans(): Promise<{ containers: number; volumes: number }> {
    const ageMs = reapAgeMs();
    const cutoff = Date.now() - ageMs;
    let containers = 0;
    let volumes = 0;

    try {
      const list = await docker.listContainers({
        all: true,
        filters: { label: [RUN_ID_LABEL] },
      });
      for (const c of list) {
        // c.Created is unix epoch seconds. Reap only containers that are
        // not currently running and whose creation predates the cutoff.
        const reapableState = c.State === 'created' || c.State === 'exited' || c.State === 'dead';
        if (!reapableState) continue;
        if (c.Created * 1000 > cutoff) continue;
        try {
          await docker.getContainer(c.Id).remove({ force: true });
          containers += 1;
        } catch { /* swallow */ }
      }
    } catch { /* swallow */ }

    try {
      const vlist = await docker.listVolumes({ filters: { label: [RUN_ID_LABEL] } });
      for (const v of vlist.Volumes ?? []) {
        try {
          // No `force`: still-mounted volumes (active runs) error out and
          // we leave them alone. Reapable ones get removed.
          await docker.getVolume(v.Name).remove();
          volumes += 1;
        } catch { /* swallow */ }
      }
    } catch { /* swallow */ }

    return { containers, volumes };
  }
}

/*
 * Carries cancellation state + the live Container reference so the cancel
 * hook in Execution can kill the right container without going through the
 * docker daemon by name first.
 */
interface RunState_ {
  cancelled: boolean;
  container: Dockerode.Container | null;
}

interface InternalRunResult {
  exitCode: number;
  timedOut: boolean;
}

/*
 * Attach to the container's stdio, start it, pipe `request.input` (if any)
 * to stdin, stream stdout/stderr to `request.onLog`, then wait for exit.
 * Honors `request.timeout` (SIGKILL fallback) and `state.cancelled`
 * (cooperative shutdown via Execution.cancel).
 */
async function runContainer(
  container: Dockerode.Container,
  request: RunRequest,
  state: RunState_,
): Promise<InternalRunResult> {
  const wantsStdin = request.input !== undefined;

  const stream = (await container.attach({
    stream: true,
    stdin: wantsStdin,
    stdout: true,
    stderr: true,
    hijack: wantsStdin,
  })) as Duplex;

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  if (request.onLog) {
    let stdoutBuf = '';
    let stderrBuf = '';
    stdout.on('data', (b: Buffer) => {
      stdoutBuf += b.toString('utf8');
      stdoutBuf = drainLines(stdoutBuf, request.onLog!);
    });
    stderr.on('data', (b: Buffer) => {
      stderrBuf += b.toString('utf8');
      stderrBuf = drainLines(stderrBuf, request.onLog!);
    });
  } else {
    // Drain even if unread, otherwise the container blocks on a full pipe.
    stdout.on('data', () => { /* drop */ });
    stderr.on('data', () => { /* drop */ });
  }

  container.modem.demuxStream(stream, stdout, stderr);

  await container.start();

  if (wantsStdin) {
    try {
      stream.write(JSON.stringify(request.input));
      stream.end();
    } catch { /* stdin may close early */ }
  }

  let timedOut = false;
  const timeoutMs = request.timeout ?? DEFAULT_TIMEOUT_MS;
  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        container.kill().catch(() => { /* swallow */ });
      }, timeoutMs)
    : null;

  try {
    const wait = (await container.wait()) as { StatusCode: number };
    return { exitCode: wait.StatusCode, timedOut };
  } catch {
    // wait can 404 if AutoRemove tore the container down before we asked.
    return { exitCode: -1, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function drainLines(buf: string, onLog: (line: string) => void): string {
  let i: number;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i);
    if (line.length > 0) onLog(line);
    buf = buf.slice(i + 1);
  }
  return buf;
}

async function ensureIsolatedNetwork(): Promise<void> {
  try {
    await docker.getNetwork(ISOLATED_NETWORK).inspect();
    return;
  } catch {
    // Not found - create it.
  }
  try {
    await docker.createNetwork({
      Name: ISOLATED_NETWORK,
      Driver: 'bridge',
      Options: { 'com.docker.network.bridge.enable_icc': 'false' },
    });
  } catch {
    // Race with another concurrent runner is fine; first creator wins.
  }
}

function validateRequest(request: RunRequest): void {
  if (!request.image || typeof request.image !== 'string') {
    throw new Error('RunRequest.image is required');
  }
  if (request.detached) {
    /*
     * Detached contract: stdin can not survive a host process death, so we
     * make the constraint explicit at the API rather than silently dropping
     * input. The runner can not stream `onLog` either, but that only costs
     * logs and does not change correctness.
     */
    if (request.input !== undefined) {
      throw new Error('RunRequest.input is not supported with detached: true');
    }
  }
}

async function containerExists(containerName: string): Promise<boolean> {
  try {
    await docker.getContainer(containerName).inspect();
    return true;
  } catch {
    return false;
  }
}

/*
 * Poll for a container to appear in docker. Used by `attach()` to bridge the
 * window between the state file being written (sync, in `run()`) and the
 * container being created (async, in `executeDetached`). Returns true as soon
 * as the container shows up, false once the deadline is reached.
 */
async function waitForContainer(containerName: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await containerExists(containerName)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

