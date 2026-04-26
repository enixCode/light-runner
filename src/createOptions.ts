import type Dockerode from 'dockerode';
import {
  DANGEROUS_CAPS,
  DEFAULT_CPUS,
  DEFAULT_MEMORY,
  DEFAULT_PIDS_LIMIT,
  ISOLATED_NETWORK,
  RUN_ID_LABEL,
} from './constants.js';
import type { RunRequest, RunnerOptions } from './types.js';

interface BuildOptionsInput {
  request: RunRequest;
  options: RunnerOptions;
  containerName: string;
  volumeName: string;
  workdir: string;
  runId: string;
  /*
   * When true, build options for a detached run: drop AutoRemove, do not
   * attach stdio. The caller cleans up the container after `wait()` resolves.
   */
  detached?: boolean;
}

// Pure: no I/O, no docker calls - safe to unit-test without Docker.
export function buildContainerCreateOptions(
  input: BuildOptionsInput,
): Dockerode.ContainerCreateOptions {
  const { request, options, containerName, volumeName, workdir, runId, detached } = input;

  const memoryBytes = parseMemoryString(options.memory ?? DEFAULT_MEMORY);
  const nanoCpus = parseCpus(options.cpus ?? DEFAULT_CPUS);
  const network = resolveNetwork(request.network);
  const noNewPrivileges = options.noNewPrivileges ?? true;
  const securityOpt: string[] = noNewPrivileges ? ['no-new-privileges'] : [];

  const env: string[] = [];
  if (request.env) {
    for (const [name, value] of Object.entries(request.env)) {
      if (isValidEnvName(name)) env.push(`${name}=${value}`);
    }
  }

  // Stdin is meaningful only for attached runs that pipe `request.input`.
  // Detached runs reject `input` upstream, so we keep stdio fully closed.
  const wantsStdin = !detached && request.input !== undefined;

  const hostConfig: Dockerode.HostConfig = {
    AutoRemove: !detached,
    Binds: [`${volumeName}:${workdir}`],
    Memory: memoryBytes,
    NanoCpus: nanoCpus,
    NetworkMode: network,
    PidsLimit: DEFAULT_PIDS_LIMIT,
    SecurityOpt: securityOpt,
    CapDrop: DANGEROUS_CAPS,
  };

  if (options.runtime && options.runtime !== 'runc') {
    hostConfig.Runtime = options.runtime;
  }

  if (options.gpus !== undefined && options.gpus !== '') {
    const gpus = String(options.gpus);
    if (!isValidGpusValue(gpus)) {
      throw new Error(`invalid gpus value: ${gpus}`);
    }
    hostConfig.DeviceRequests = parseGpus(gpus);
  }

  const opts: Dockerode.ContainerCreateOptions = {
    name: containerName,
    Image: request.image,
    Labels: { [RUN_ID_LABEL]: runId },
    WorkingDir: workdir,
    Env: env,
    Tty: false,
    OpenStdin: wantsStdin,
    StdinOnce: wantsStdin,
    AttachStdin: wantsStdin,
    AttachStdout: !detached,
    AttachStderr: !detached,
    HostConfig: hostConfig,
  };

  if (request.command !== undefined) {
    opts.Entrypoint = ['sh'];
    opts.Cmd = ['-c', request.command];
  }

  return opts;
}

function resolveNetwork(network: string | undefined): string {
  if (network === undefined || network.length === 0) return ISOLATED_NETWORK;
  return network;
}

function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function isValidGpusValue(value: string): boolean {
  if (value.length === 0 || value.startsWith('-')) return false;
  return /^[a-zA-Z0-9,=.:"\-_ ]+$/.test(value);
}

// Returns bytes - HostConfig.Memory takes raw bytes, not Docker-style strings.
function parseMemoryString(value: string): number {
  const m = /^(\d+)([kmg])?$/i.exec(value.trim());
  if (!m) throw new Error(`invalid memory value: ${value}`);
  const n = Number.parseInt(m[1]!, 10);
  const unit = (m[2] ?? '').toLowerCase();
  switch (unit) {
    case '': return n;
    case 'k': return n * 1024;
    case 'm': return n * 1024 * 1024;
    case 'g': return n * 1024 * 1024 * 1024;
    default: throw new Error(`invalid memory unit: ${value}`);
  }
}

// HostConfig.NanoCpus uses 1e-9 cores: '1.5' cpus -> 1_500_000_000.
function parseCpus(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid cpus value: ${value}`);
  }
  return Math.round(n * 1_000_000_000);
}

// Supports `--gpus` forms: 'all', '0', '0,1', 'device=0', '"device=0,1"'.
function parseGpus(value: string): Dockerode.DeviceRequest[] {
  const stripped = value.replace(/^"(.*)"$/, '$1').trim();
  if (stripped === 'all') {
    return [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }];
  }
  const idsPart = stripped.startsWith('device=') ? stripped.slice('device='.length) : stripped;
  const ids = idsPart.split(',').map((s) => s.trim()).filter(Boolean);
  return [{ Driver: 'nvidia', DeviceIDs: ids, Capabilities: [['gpu']] }];
}
