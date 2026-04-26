import http from 'node:http';
import Docker from 'dockerode';
import { DOCKER_PING_TIMEOUT_MS } from './constants.js';
import { LightRunnerError } from './errors.js';

/*
 * Resolve the docker daemon endpoint. Honors `DOCKER_HOST` first (npipe://,
 * unix://, tcp://). On Windows without `DOCKER_HOST`, Docker Desktop and the
 * legacy daemon use different named pipes and the wrong one silently accepts
 * connections then never responds - we probe both in parallel and pick the
 * first that answers. No CLI dependency.
 */
const WIN_PIPES = [
  '//./pipe/dockerDesktopLinuxEngine', // Docker Desktop (most installs)
  '//./pipe/docker_engine',            // legacy / direct dockerd
];

type DockerOpts = ConstructorParameters<typeof Docker>[0];

function optsFromEnv(): DockerOpts | undefined {
  const host = process.env.DOCKER_HOST;
  if (!host) return undefined;
  if (host.startsWith('unix://')) return { socketPath: host.slice('unix://'.length) };
  if (host.startsWith('npipe://')) return { socketPath: host.slice('npipe://'.length) };
  // tcp:// is handled by dockerode's own URL parsing - pass through.
  return undefined;
}

function probeSocketPath(socketPath: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath, method: 'GET', path: '/_ping', headers: { Host: 'docker' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve((res.statusCode ?? 500) < 500 ? socketPath : null));
        res.on('error', () => resolve(null));
      },
    );
    req.on('error', () => resolve(null));
    const timer = setTimeout(() => { req.destroy(); resolve(null); }, timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

let resolved: Docker | null = null;
let resolving: Promise<Docker> | null = null;

async function resolveDocker(timeoutMs: number): Promise<Docker> {
  if (resolved) return resolved;
  if (resolving) return resolving;

  resolving = (async (): Promise<Docker> => {
    const envOpts = optsFromEnv();
    if (envOpts) return (resolved = new Docker(envOpts));

    if (process.platform !== 'win32') return (resolved = new Docker());

    // Probe both pipes concurrently; the first to answer wins. Promise.any
    // rejects only if every probe yields null, in which case we fall back to
    // dockerode default so subsequent calls surface a real error.
    try {
      const pipe = await Promise.any(
        WIN_PIPES.map((p) => probeSocketPath(p, timeoutMs).then((r) => r ?? Promise.reject())),
      );
      return (resolved = new Docker({ socketPath: pipe }));
    } catch {
      return (resolved = new Docker());
    }
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

/*
 * Lazy proxy: keeps the public `docker.xxx()` shape synchronous-looking while
 * resolution happens on the first awaited call (typically `pingDaemon`). The
 * fallback handles fire-and-forget cleanups (e.g. `getContainer(name).kill()`)
 * issued before any await - on Windows that means hitting the legacy pipe,
 * which silently no-ops instead of hanging.
 */
const fallback = new Docker(optsFromEnv() ?? (process.platform === 'win32'
  ? { socketPath: WIN_PIPES[1] }
  : undefined));

export const docker = new Proxy<Docker>(fallback, {
  get(_target, prop) {
    const target = resolved ?? fallback;
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as Docker;

type PingOutcome = 'ok' | 'timeout' | { error: Error };

/*
 * Pre-flight health check + first-call daemon resolution. On Windows this
 * picks the right named pipe on its first call and caches the result.
 */
export async function pingDaemon(timeoutMs: number = DOCKER_PING_TIMEOUT_MS): Promise<void> {
  const client = await resolveDocker(timeoutMs);
  const result = await Promise.race<PingOutcome>([
    client.ping().then((): PingOutcome => 'ok').catch((e: unknown): PingOutcome => ({
      error: e instanceof Error ? e : new Error(String(e)),
    })),
    new Promise<PingOutcome>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
  ]);

  if (result === 'ok') return;
  if (result === 'timeout') {
    throw new LightRunnerError({
      code: 'DOCKER_UNREACHABLE',
      message: `docker daemon ping timed out after ${timeoutMs}ms`,
      dockerOp: 'ping',
    });
  }
  throw new LightRunnerError({
    code: 'DOCKER_UNREACHABLE',
    message: `docker daemon unreachable: ${result.error.message}`,
    dockerOp: 'ping',
    cause: result.error,
  });
}
