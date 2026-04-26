import { docker } from './docker.js';
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

  /*
   * Mark cancelled, run the local hook, fire-and-forget a docker kill.
   * Stays sync to preserve the v0.9 API: callers expect cancel() to return
   * immediately. The kill happens in the background; the result promise
   * resolves once the container exits.
   */
  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    try {
      this._onCancel();
    } catch { /* swallow */ }
    docker.getContainer(this.id).kill().catch(() => { /* swallow */ });
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  /*
   * Graceful stop: deliver SIGTERM (or a custom signal), wait `grace` ms,
   * then SIGKILL if the container is still alive. Marks the execution as
   * cancelled. Safe to call on an already-stopped container (no-op).
   */
  async stop(options: StopOptions = {}): Promise<void> {
    const signal = options.signal ?? 'SIGTERM';
    const grace = options.grace ?? 10_000;

    if (this._cancelled) return;
    this._cancelled = true;

    try {
      this._onCancel();
    } catch { /* swallow */ }

    const container = docker.getContainer(this.id);

    // An unknown signal returns 4xx; we swallow because the grace timer
    // still fires SIGKILL below.
    await container.kill({ signal }).catch(() => { /* swallow */ });

    if (grace <= 0) {
      await container.kill().catch(() => { /* swallow */ });
      return;
    }

    await new Promise((r) => setTimeout(r, grace));

    try {
      const info = await container.inspect();
      if (info.State?.Running) {
        await container.kill().catch(() => { /* swallow */ });
      }
    } catch {
      // inspect 404 = container already gone, nothing to kill
    }
  }

  /*
   * Freeze the container at the cgroup level. Memory preserved, CPU stops.
   * Does not flip `cancelled`: a paused run can still complete after resume().
   */
  async pause(): Promise<void> {
    try {
      await docker.getContainer(this.id).pause();
    } catch (err) {
      throw new Error(`docker pause failed: ${(err as Error).message}`);
    }
  }

  async resume(): Promise<void> {
    try {
      await docker.getContainer(this.id).unpause();
    } catch (err) {
      throw new Error(`docker unpause failed: ${(err as Error).message}`);
    }
  }
}
