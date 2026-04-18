export const ISOLATED_NETWORK = 'light-runner-isolated';
export const SEEDER_IMAGE = 'alpine:3.19';
export const DEFAULT_WORKDIR = '/app';
export const VOLUME_PREFIX = 'light-runner-';
export const DEFAULT_PIDS_LIMIT = 100;
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
// Hard cap on per-container RAM. Without this, a single run can eat all host
// memory and swap the host. 512m is enough for most Node/Python workloads.
export const DEFAULT_MEMORY = '512m';
// CPU budget per container (1.0 = one core-equivalent of CPU time, shared
// across all host cores). Prevents one run from starving the host.
export const DEFAULT_CPUS = '1';
// Max size per extract spec. Streamed disk-to-disk, never buffered in Node.
export const MAX_EXTRACT_BYTES = 1024 * 1024 * 1024;

// Linux capabilities dropped on every run. Docker keeps a permissive default
// set - we strip the ones that enable container-escape or network abuse.
export const DANGEROUS_CAPS = [
  // Raw/packet sockets - ARP spoofing, packet crafting, low-level scanning.
  'NET_RAW',
  // Create special device files (mknod) - can fabricate device nodes to
  // access host devices if the container has any bind-mounted path.
  'MKNOD',
  // Call chroot(2) - lets a process escape a weaker chroot jail.
  'SYS_CHROOT',
  // Modify capability sets of other processes - privilege escalation vector.
  'SETPCAP',
  // Set file capabilities - escalation via setcap on dropped binaries.
  'SETFCAP',
  // Write to kernel audit log - log flooding / audit spoofing.
  'AUDIT_WRITE',
];

export const MAX_CONTAINER_NAME_LENGTH = 128;
export const CONTAINER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

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
