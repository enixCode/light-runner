export type LightRunnerErrorCode =
  | 'DOCKER_UNREACHABLE'
  | 'VOLUME_CREATE_FAILED'
  | 'CONTAINER_START_FAILED'
  | 'SEED_FAILED'
  | 'EXTRACT_FAILED';

interface LightRunnerErrorOptions {
  code: LightRunnerErrorCode;
  message: string;
  dockerOp?: string;
  containerId?: string;
  cause?: unknown;
}

/*
 * Structured error type so callers (light-run, light-process) can
 * react to specific failure classes without parsing message strings.
 * Serializable: toJSON drops `cause` to keep payloads small and avoid
 * leaking internal stack traces over the wire.
 */
export class LightRunnerError extends Error {
  readonly code: LightRunnerErrorCode;
  readonly dockerOp?: string;
  readonly containerId?: string;

  constructor(opts: LightRunnerErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'LightRunnerError';
    this.code = opts.code;
    if (opts.dockerOp !== undefined) this.dockerOp = opts.dockerOp;
    if (opts.containerId !== undefined) this.containerId = opts.containerId;
  }

  toJSON(): {
    name: string;
    code: LightRunnerErrorCode;
    message: string;
    dockerOp?: string;
    containerId?: string;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.dockerOp !== undefined ? { dockerOp: this.dockerOp } : {}),
      ...(this.containerId !== undefined ? { containerId: this.containerId } : {}),
    };
  }
}
