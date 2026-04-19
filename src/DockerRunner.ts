import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { buildDockerArgs } from './args.js';
import { Execution } from './Execution.js';
import {
  CONTAINER_NAME_REGEX,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WORKDIR,
  ISOLATED_NETWORK,
  MAX_CONTAINER_NAME_LENGTH,
  VOLUME_PREFIX,
} from './constants.js';
import { listStates, readState, updateState, writeState } from './state.js';
import type { RunState } from './state.js';
import {
  cleanupOrphanVolumes,
  createVolume,
  destroyVolume,
  extractFromVolume,
  seedVolume,
} from './volume.js';
import type { ExtractResult, RunnerOptions, RunRequest, RunResult } from './types.js';

export class DockerRunner {
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = options;
  }

  run(request: RunRequest): Execution {
    const workdir = request.workdir ?? DEFAULT_WORKDIR;
    validateRequest(request);

    const execId = randomUUID();
    const shortId = execId.slice(0, 12);
    const containerName = truncateName(`${VOLUME_PREFIX}${shortId}`);
    const volumeName = containerName;
    const network = request.network;

    if (request.detached) {
      return this.runDetached({ request, containerName, volumeName, workdir, network });
    }

    const state = { cancelled: false, child: null as ReturnType<typeof spawn> | null };

    const result = this.execute({
      request,
      containerName,
      volumeName,
      workdir,
      network,
      state,
    });

    const execution = new Execution(containerName, result, () => {
      state.cancelled = true;
      state.child?.kill('SIGKILL');
    });

    if (request.signal) {
      if (request.signal.aborted) {
        execution.cancel();
      } else {
        request.signal.addEventListener('abort', () => execution.cancel(), { once: true });
      }
    }

    return execution;
  }

  private runDetached(ctx: {
    request: RunRequest;
    containerName: string;
    volumeName: string;
    workdir: string;
    network: string | undefined;
  }): Execution {
    const { request, containerName, volumeName, workdir, network } = ctx;
    const state = { cancelled: false };

    const result = this.executeDetached({
      request,
      containerName,
      volumeName,
      workdir,
      network,
      state,
    });

    const execution = new Execution(containerName, result, () => {
      state.cancelled = true;
      // No local child process to kill - the container runs independently.
      // We stop it via the docker daemon, and docker wait (in executeDetached)
      // will return as soon as the container exits.
      spawnSync('docker', ['kill', containerName], { stdio: 'ignore' });
    });

    if (request.signal) {
      if (request.signal.aborted) {
        execution.cancel();
      } else {
        request.signal.addEventListener('abort', () => execution.cancel(), { once: true });
      }
    }

    return execution;
  }

  private async executeDetached(ctx: {
    request: RunRequest;
    containerName: string;
    volumeName: string;
    workdir: string;
    network: string | undefined;
    state: { cancelled: boolean };
  }): Promise<RunResult> {
    const { request, containerName, volumeName, workdir, network, state } = ctx;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();

    let volumeCreated = false;
    let containerStarted = false;

    try {
      createVolume(volumeName);
      volumeCreated = true;

      await seedVolume(volumeName, {
        dir: request.dir,
        workdir,
      });

      if (network === undefined || network === '') {
        ensureIsolatedNetwork();
      }

      const args = buildDockerArgs({
        request,
        options: this.options,
        containerName,
        volumeName,
        workdir,
        detached: true,
      });

      // Start the container in the background. This returns immediately with
      // the container ID on stdout, which we ignore (we already know the name).
      const spawnResult = spawnSync('docker', args, { encoding: 'utf8' });
      if (spawnResult.status !== 0) {
        throw new Error(`docker run -d failed: ${spawnResult.stderr || spawnResult.stdout}`);
      }
      containerStarted = true;

      // Persist before awaiting exit so a crash during the run leaves a
      // reconstructable state file.
      writeState({
        id: containerName,
        container: containerName,
        volume: volumeName,
        image: request.image,
        workdir,
        command: request.command,
        timeout: request.timeout,
        extract: request.extract,
        startedAt,
        status: 'running',
      });

      const exitCode = await waitForContainer(containerName);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - started;

      let extracted: ExtractResult[] | undefined;
      if (request.extract?.length && exitCode === 0 && !state.cancelled) {
        extracted = await extractFromVolume(volumeName, workdir, request.extract);
      }

      const success = exitCode === 0 && !state.cancelled;

      updateState(containerName, {
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
      updateState(containerName, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
      throw err;
    } finally {
      if (containerStarted) {
        // `docker run -d` without --rm leaves the exited container around so
        // that `docker wait` can be called. Clean it up now.
        spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
      }
      if (volumeCreated) destroyVolume(volumeName);
    }
  }

  private async execute(ctx: {
    request: RunRequest;
    containerName: string;
    volumeName: string;
    workdir: string;
    network: string | undefined;
    state: { cancelled: boolean; child: ReturnType<typeof spawn> | null };
  }): Promise<RunResult> {
    const { request, containerName, volumeName, workdir, network, state } = ctx;
    const started = Date.now();

    let volumeCreated = false;
    try {
      createVolume(volumeName);
      volumeCreated = true;

      await seedVolume(volumeName, {
        dir: request.dir,
        workdir,
      });

      if (network === undefined || network === '') {
        ensureIsolatedNetwork();
      }

      const args = buildDockerArgs({
        request,
        options: this.options,
        containerName,
        volumeName,
        workdir,
      });

      const runResult = await runContainer(args, request, state);

      let extracted: ExtractResult[] | undefined;
      if (request.extract?.length && runResult.exitCode === 0 && !state.cancelled) {
        extracted = await extractFromVolume(volumeName, workdir, request.extract);
      }

      const duration = Date.now() - started;
      const success = runResult.exitCode === 0 && !state.cancelled && !runResult.timedOut;

      return {
        success,
        exitCode: runResult.exitCode,
        duration,
        cancelled: state.cancelled,
        ...(extracted ? { extracted } : {}),
      };
    } finally {
      if (volumeCreated) destroyVolume(volumeName);
    }
  }

  static isAvailable(): boolean {
    const r = spawnSync('docker', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
  }

  static cleanupOrphanVolumes(): number {
    return cleanupOrphanVolumes();
  }

  /*
   * Re-attach to a previously-started detached run by its id. Returns an
   * Execution whose `.result` resolves the same way as the original call did,
   * or null if no state file exists for that id.
   *
   * Terminal states (exited / cancelled / failed) resolve immediately from
   * the persisted data. Running state triggers a fresh `docker wait` so the
   * new host can pick up where the previous one left off.
   */
  static attach(id: string): Execution | null {
    const state = readState(id);
    if (!state) return null;

    if (state.status !== 'running') {
      // Already terminal. Build a resolved Execution from the state file.
      const resolved: RunResult = {
        success: state.status === 'exited' && !state.cancelled && state.exitCode === 0,
        exitCode: state.exitCode ?? -1,
        duration: state.durationMs ?? 0,
        cancelled: state.cancelled === true,
      };
      return new Execution(id, Promise.resolve(resolved), () => {
        /* no-op: the container is already gone */
      });
    }

    // Running. Check the container still exists before waiting.
    const exists = containerExists(state.container);
    if (!exists) {
      // Ghost state: state says running but docker lost track. Mark it.
      updateState(id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
      return new Execution(id, Promise.resolve({
        success: false,
        exitCode: -1,
        duration: 0,
        cancelled: false,
      }), () => { /* no-op */ });
    }

    const cancelState = { cancelled: false };
    const started = Date.parse(state.startedAt);
    const result = (async (): Promise<RunResult> => {
      try {
        const exitCode = await waitForContainer(state.container);
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
        // Best-effort cleanup - the original run's finally block may already
        // have removed the container if it ran on the same host.
        spawnSync('docker', ['rm', '-f', state.container], { stdio: 'ignore' });
        destroyVolume(state.volume);
      }
    })();

    return new Execution(id, result, () => {
      cancelState.cancelled = true;
      spawnSync('docker', ['kill', state.container], { stdio: 'ignore' });
    });
  }

  /*
   * Enumerate all known runs (active + terminal) from the state dir.
   * Identical to `listStates()` - kept as a static on DockerRunner for
   * discoverability and future extension (e.g. filter by status).
   */
  static list(): RunState[] {
    return listStates();
  }

  /*
   * Reconcile state files with the docker daemon. For every state marked
   * `running`, check whether the container still exists. If not, mark it
   * as `failed` (ghost state). Returns the number of states updated.
   *
   * Should be called on host startup before accepting new work.
   */
  static cleanupOrphanStates(): number {
    const states = listStates();
    let fixed = 0;
    for (const s of states) {
      if (s.status !== 'running') continue;
      if (containerExists(s.container)) continue;
      updateState(s.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
      });
      fixed++;
    }
    return fixed;
  }
}

interface InternalRunResult {
  exitCode: number;
  timedOut: boolean;
}

function runContainer(
  args: string[],
  request: RunRequest,
  state: { cancelled: boolean; child: ReturnType<typeof spawn> | null },
): Promise<InternalRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    state.child = child;

    let timedOut = false;

    const onChunk = (chunk: Buffer) => {
      if (!request.onLog) return;
      emitLines(chunk.toString('utf8'), request.onLog);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);

    try {
      if (request.input !== undefined) {
        child.stdin.write(JSON.stringify(request.input));
      }
      child.stdin.end();
    } catch {
      // stdin may close early - ignore
    }

    const timeout = request.timeout ?? DEFAULT_TIMEOUT_MS;
    const timer = timeout > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeout)
      : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        timedOut,
      });
    });
  });
}

function ensureIsolatedNetwork(): void {
  const inspect = spawnSync('docker', ['network', 'inspect', ISOLATED_NETWORK], { stdio: 'ignore' });
  if (inspect.status === 0) return;
  spawnSync(
    'docker',
    ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.enable_icc=false', ISOLATED_NETWORK],
    { stdio: 'ignore' },
  );
}

function validateRequest(request: RunRequest): void {
  if (!request.image || typeof request.image !== 'string') {
    throw new Error('RunRequest.image is required');
  }
  if (request.detached) {
    /*
     * Detached contract: stdin can't survive a host process death, so we make
     * the constraint explicit at the API rather than silently dropping input.
     * The runner can't stream `onLog` either, but that only costs logs and
     * does not change correctness, so we warn-by-convention in the type docs.
     */
    if (request.input !== undefined) {
      throw new Error('RunRequest.input is not supported with detached: true');
    }
  }
}

function containerExists(containerName: string): boolean {
  const r = spawnSync('docker', ['inspect', '--type=container', containerName], {
    stdio: 'ignore',
  });
  return r.status === 0;
}

function waitForContainer(containerName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['wait', containerName], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`docker wait exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      const parsed = parseInt(stdout.trim(), 10);
      if (Number.isNaN(parsed)) {
        reject(new Error(`docker wait returned non-numeric output: ${stdout.trim()}`));
        return;
      }
      resolve(parsed);
    });
  });
}

function truncateName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_.-]/g, '-');
  const truncated = cleaned.slice(0, MAX_CONTAINER_NAME_LENGTH);
  if (!CONTAINER_NAME_REGEX.test(truncated)) {
    return `${VOLUME_PREFIX}${Date.now()}`;
  }
  return truncated;
}

function emitLines(text: string, onLog: (line: string) => void): void {
  for (const line of text.split('\n')) {
    if (line.length > 0) onLog(line);
  }
}
