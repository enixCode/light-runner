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
