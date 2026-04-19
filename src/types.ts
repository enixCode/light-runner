export type Runtime = 'runc' | 'runsc' | 'kata';

export interface RunnerOptions {
  memory?: string;
  cpus?: string;
  runtime?: Runtime;
  gpus?: 'all' | number | string;
  noNewPrivileges?: boolean;
}

export interface ExtractSpec {
  /*
   * Path inside the container. Absolute, or relative to the workdir.
   * Paths containing `..` are rejected (no traversal).
   */
  from: string;
  /*
   * Host destination directory. Auto-created (recursive mkdir).
   *   - If `from` is a directory: its contents land directly in `to`
   *     (rsync-like: `from/*` -> `to/*`, no basename wrap).
   *   - If `from` is a file: it lands as `to/basename(from)`.
   */
  to: string;
}

export interface ExtractResult {
  from: string;
  to: string;
  status: 'ok' | 'missing' | 'error';
  error?: string;
  bytes?: number;
}

export interface RunRequest {
  image: string;
  /*
   * Shell command to run inside the container, e.g. `'node index.js'`.
   * Executed as `sh -c <command>`, so any image with `sh` works.
   * Omit to run the image's built-in entrypoint instead.
   */
  command?: string;
  /*
   * Host path to a directory whose contents are copied into workdir root,
   * internal structure preserved. Entries named .git, node_modules, dist,
   * build, .next, .cache, .turbo, coverage are skipped. Symlinks are skipped.
   * Omit for an empty volume.
   */
  dir?: string;
  input?: unknown;
  timeout?: number;
  /*
   * `undefined` = isolated bridge (default),
   * `'none'` = no network,
   * string = named network.
  */
  network?: string;
  env?: Record<string, string>;
  workdir?: string;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  /*
   * Files or folders to stream out of the container after a successful run,
   * disk-to-disk. Capped at 1 GiB per entry. Missing paths are reported in
   * `RunResult.extracted`, they do not fail the run.
   */
  extract?: ExtractSpec[];
  /*
   * When true, the container starts with `docker run -d` and the host process
   * returns immediately. The run state is persisted under the state dir so a
   * crashed host can resume it via `DockerRunner.attach(id)` later.
   *
   * Contract changes in detached mode:
   *   - `input` is rejected (no stdin can survive process death)
   *   - `onLog` is not called (no stream to host; use `docker logs` instead)
   *   - The returned Execution.result still resolves when the container exits
   *     for the host that launched it; a second host can re-attach by id.
   */
  detached?: boolean;
}

export interface RunResult {
  success: boolean;
  exitCode: number;
  duration: number;
  cancelled: boolean;
  /** Status of each requested extract. Present only if `extract` was set. */
  extracted?: ExtractResult[];
}
