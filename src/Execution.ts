import { spawnSync } from 'node:child_process';
import type { RunResult } from './types.js';

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
}
