import os from 'node:os';
import path from 'node:path';

export const ISOLATED_NETWORK = 'light-runner-isolated';
export const SEEDER_IMAGE = 'alpine:3.19';
export const DEFAULT_WORKDIR = '/app';
export const VOLUME_PREFIX = 'light-runner-';

// Read at call time so tests can override the env var in-process.
export function stateDir(): string {
  return process.env.LIGHT_RUNNER_STATE_DIR
    ?? path.join(os.homedir(), '.light-runner', 'state');
}
export const DEFAULT_PIDS_LIMIT = 100;
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_MEMORY = '512m';
export const DEFAULT_CPUS = '1';
export const MAX_EXTRACT_BYTES = 1024 * 1024 * 1024;

// Caps that enable container-escape or network abuse - dropped on every run.
export const DANGEROUS_CAPS = [
  'NET_RAW',      // raw/packet sockets: ARP spoofing, packet crafting
  'MKNOD',        // fabricate device nodes via mknod
  'SYS_CHROOT',   // escape weaker chroot jails
  'SETPCAP',      // modify capability sets of other processes
  'SETFCAP',      // escalation via setcap on dropped binaries
  'AUDIT_WRITE',  // kernel audit log flooding / spoofing
];

export const RUN_ID_LABEL = 'light-runner.run-id';
export const DEFAULT_REAP_AGE_MS = 5 * 60_000;
export const DOCKER_PING_TIMEOUT_MS = 5_000;

export function reapAgeMs(): number {
  const raw = process.env.LIGHT_RUNNER_REAP_AGE_MS;
  if (raw === undefined) return DEFAULT_REAP_AGE_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REAP_AGE_MS;
}

export const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.cache',
  '.turbo',
  'coverage',
]);
