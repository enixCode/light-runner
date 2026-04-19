import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * The state module reads STATE_DIR from env at import time. We override the
 * env before importing so each test suite hits its own tmpdir.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-state-'));
process.env.LIGHT_RUNNER_STATE_DIR = tmp;

const { writeState, readState, listStates, updateState, deleteState } = await import(
  '../../src/state.js'
);

function mkState(id: string) {
  return {
    id,
    container: id,
    volume: id,
    image: 'alpine:3.19',
    workdir: '/app',
    startedAt: new Date().toISOString(),
    status: 'running' as const,
  };
}

describe('state', () => {
  beforeEach(() => {
    // Clear files but keep dir so STATE_DIR stays valid.
    for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
  });

  afterEach(() => {
    for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f), { force: true });
  });

  it('readState returns null for an unknown id', () => {
    assert.equal(readState('nope'), null);
  });

  it('writeState then readState round-trips', () => {
    const s = mkState('r1');
    writeState(s);
    const read = readState('r1');
    assert.deepEqual(read, s);
  });

  it('writeState uses atomic rename (no .tmp left behind)', () => {
    writeState(mkState('r2'));
    const files = fs.readdirSync(tmp);
    const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
  });

  it('updateState patches fields while keeping the rest', () => {
    writeState(mkState('r3'));
    updateState('r3', { status: 'exited', exitCode: 0 });
    const read = readState('r3');
    assert.equal(read?.status, 'exited');
    assert.equal(read?.exitCode, 0);
    assert.equal(read?.image, 'alpine:3.19'); // unchanged
  });

  it('updateState is a no-op for unknown ids', () => {
    updateState('nope', { status: 'exited' });
    assert.equal(readState('nope'), null);
  });

  it('listStates returns all readable states, skipping corrupt files', () => {
    writeState(mkState('r4'));
    writeState(mkState('r5'));
    fs.writeFileSync(path.join(tmp, 'bad.json'), 'not json', 'utf8');
    const states = listStates();
    const ids = states.map((s) => s.id).sort();
    assert.deepEqual(ids, ['r4', 'r5']);
  });

  it('deleteState removes the file', () => {
    writeState(mkState('r6'));
    assert.ok(readState('r6'));
    deleteState('r6');
    assert.equal(readState('r6'), null);
  });

  it('deleteState is idempotent on missing files', () => {
    deleteState('nope'); // must not throw
    assert.ok(true);
  });
});
