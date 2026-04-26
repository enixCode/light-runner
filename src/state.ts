import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './constants.js';
import type { ExtractSpec } from './types.js';

// One JSON file per run id under stateDir(): lets detached runs be resumed
// across host process restarts.
export interface RunState {
  id: string;
  container: string;
  volume: string;
  image: string;
  workdir: string;
  command?: string;
  timeout?: number;
  extract?: ExtractSpec[];
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'exited' | 'cancelled' | 'failed';
  exitCode?: number;
  durationMs?: number;
  /*
   * Set when the run was terminated by an explicit cancel (cancel / abort /
   * stop). Lets callers distinguish a clean exit 0 from a cancelled run that
   * happened to exit 0 by race.
   */
  cancelled?: boolean;
}

function ensureDir(): void {
  fs.mkdirSync(stateDir(), { recursive: true });
}

function filePath(id: string): string {
  return path.join(stateDir(), `${id}.json`);
}

export function writeState(state: RunState): void {
  ensureDir();
  // Atomic via temp + rename: avoids torn files if the host dies mid-write.
  const tmp = `${filePath(state.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, filePath(state.id));
}

export function readState(id: string): RunState | null {
  try {
    const raw = fs.readFileSync(filePath(id), 'utf8');
    return JSON.parse(raw) as RunState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function listStates(): RunState[] {
  let files: string[];
  try {
    files = fs.readdirSync(stateDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: RunState[] = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = fs.readFileSync(path.join(stateDir(), f), 'utf8');
      out.push(JSON.parse(raw) as RunState);
    } catch {
      // Skip corrupt files; they'll get cleaned up on next successful write.
    }
  }
  return out;
}

export function updateState(id: string, patch: Partial<RunState>): void {
  const existing = readState(id);
  if (!existing) return;
  writeState({ ...existing, ...patch });
}

export function deleteState(id: string): void {
  try {
    fs.unlinkSync(filePath(id));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
