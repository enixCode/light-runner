import type { RunRequest, RunnerOptions } from './types.js';
import {
  DANGEROUS_CAPS,
  DEFAULT_CPUS,
  DEFAULT_MEMORY,
  DEFAULT_PIDS_LIMIT,
  ISOLATED_NETWORK,
} from './constants.js';

export interface BuildArgsInput {
  request: RunRequest;
  options: RunnerOptions;
  containerName: string;
  volumeName: string;
  workdir: string;
}

export function buildDockerArgs(input: BuildArgsInput): string[] {
  const { request, options, containerName, volumeName, workdir } = input;
  const args: string[] = ['run', '--rm', '-i', '--name', containerName];

  const noNewPrivileges = options.noNewPrivileges ?? true;
  if (noNewPrivileges) args.push('--security-opt', 'no-new-privileges');

  for (const cap of DANGEROUS_CAPS) args.push('--cap-drop', cap);

  args.push('--pids-limit', String(DEFAULT_PIDS_LIMIT));

  const network = resolveNetwork(request.network);
  args.push('--network', network);

  args.push('--memory', options.memory ?? DEFAULT_MEMORY);
  args.push('--cpus', options.cpus ?? DEFAULT_CPUS);

  if (options.gpus) {
    const gpus = String(options.gpus);
    if (!isValidGpusValue(gpus)) {
      throw new Error(`invalid gpus value: ${gpus}`);
    }
    args.push('--gpus', gpus);
  }

  if (options.runtime && options.runtime !== 'runc') {
    args.push('--runtime', options.runtime);
  }

  args.push('-v', `${volumeName}:${workdir}`);
  args.push('-w', workdir);

  if (request.env) {
    for (const [name, value] of Object.entries(request.env)) {
      if (!isValidEnvName(name)) continue;
      args.push('-e', `${name}=${value}`);
    }
  }

  if (request.command !== undefined) {
    args.push('--entrypoint', 'sh');
  }

  args.push(request.image);

  if (request.command !== undefined) {
    args.push('-c', request.command);
  }

  return args;
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
