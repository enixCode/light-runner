import { spawnSync } from 'node:child_process';
import type { RunResult } from './types.js';

export interface StopOptions {
  /*
   * Signal to deliver first. Default SIGTERM. The container gets a chance to
   * shut down cleanly (flush buffers, close files, etc.) before being killed.
   */
  signal?: string;
  /*
   * How long to wait (ms) between the first signal and the forced SIGKILL.
   * Default 10 seconds. Set to 0 to kill immediately.
   */
  grace?: number;
}

export class Execution {
  readonly id: string;
  readonly result: Promise<RunResult>;
  private _cancelled = false;

  constructor(id: string, result: Promise<RunResult>, onCancel: () => void) {
    this.id = id;
    this.result = result;
    this._onCancel = onCancel;
  }

  private _onCancel: () => void;

  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    try {
      this._onCancel();
    } catch {
      // swallow - container may already be gone
    }
    spawnSync('docker', ['kill', this.id], { stdio: 'ignore' });
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  /*
   * Graceful stop: deliver SIGTERM (or a custom signal), wait `grace` ms,
   * then SIGKILL if the container is still alive. Marks the execution as
   * cancelled. Safe to call on an already-stopped container (no-op).
   *
   * Docker maps signal names to POSIX numbers internally. Invalid signal
   * names cause docker kill to exit non-zero, which we swallow; in that
   * case the grace timer still fires and SIGKILL cleans up.
   */
  async stop(options: StopOptions = {}): Promise<void> {
    const signal = options.signal ?? 'SIGTERM';
    const grace = options.grace ?? 10_000;

    if (this._cancelled) return;
    this._cancelled = true;

    // Mark the runner-level state as cancelled too (relies on onCancel
    // setting the shared flag - identical to cancel()).
    try {
      this._onCancel();
    } catch {
      // swallow
    }

    // Send the first signal.
    spawnSync('docker', ['kill', '-s', signal, this.id], { stdio: 'ignore' });

    if (grace <= 0) {
      // Immediate SIGKILL.
      spawnSync('docker', ['kill', this.id], { stdio: 'ignore' });
      return;
    }

    // Wait grace period, then force kill if still running.
    await new Promise((r) => setTimeout(r, grace));
    const stillRunning = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', this.id], {
      encoding: 'utf8',
    });
    if (stillRunning.status === 0 && stillRunning.stdout.trim() === 'true') {
      spawnSync('docker', ['kill', this.id], { stdio: 'ignore' });
    }
  }

  /*
   * Freeze the container at the cgroup level (docker pause). All processes
   * inside are suspended - memory preserved, CPU stops. Resume with resume().
   *
   * Does not change the cancelled flag: a paused run can still complete
   * normally after resume(). Throws if the container is not running.
   */
  pause(): void {
    const r = spawnSync('docker', ['pause', this.id], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`docker pause failed: ${(r.stderr ?? '').trim() || 'unknown error'}`);
    }
  }

  /*
   * Reverse of pause(). Resumes a paused container.
   */
  resume(): void {
    const r = spawnSync('docker', ['unpause', this.id], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(`docker unpause failed: ${(r.stderr ?? '').trim() || 'unknown error'}`);
    }
  }
}
