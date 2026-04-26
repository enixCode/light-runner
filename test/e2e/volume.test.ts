import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVolume, destroyVolume } from '../../src/volume/index.js';
import { seedVolume } from '../../src/volume/seed.js';
import { extractFromVolume } from '../../src/volume/extract.js';
import { DEFAULT_WORKDIR } from '../../src/constants.js';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

maybe('volume lifecycle', () => {
  const name = `light-runner-test-${Date.now().toString(36)}`;
  let tmpDir: string;

  before(async () => {
    await createVolume(name, name);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-vol-'));
  });

  after(async () => {
    await destroyVolume(name);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('seeds a folder and extracts a seeded file back', async () => {
    fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'world');
    await seedVolume(name, { dir: tmpDir, workdir: DEFAULT_WORKDIR });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-vol-out-'));
    try {
      const results = await extractFromVolume(name, DEFAULT_WORKDIR, [
        { from: 'hello.txt', to: out },
      ]);
      assert.equal(results[0].status, 'ok');
      assert.equal(
        fs.readFileSync(path.join(out, 'hello.txt'), 'utf8'),
        'world',
      );
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects when dir is not a directory', async () => {
    const filePath = path.join(tmpDir, 'a-file.txt');
    fs.writeFileSync(filePath, 'hello');
    await assert.rejects(() =>
      seedVolume(name, { dir: filePath, workdir: DEFAULT_WORKDIR }),
    );
  });

  it('rejects when dir path does not exist', async () => {
    await assert.rejects(() =>
      seedVolume(name, { dir: '/nope/not/here', workdir: DEFAULT_WORKDIR }),
    );
  });

  it('extracts a file and a directory, reports missing paths', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-seed-'));
    fs.writeFileSync(path.join(seedDir, 'solo.txt'), 'hello');
    fs.mkdirSync(path.join(seedDir, 'results'));
    fs.writeFileSync(path.join(seedDir, 'results', 'a.txt'), 'aaa');
    fs.writeFileSync(path.join(seedDir, 'results', 'b.txt'), 'bbb');

    const exName = `light-runner-extest-${Date.now().toString(36)}`;
    await createVolume(exName, exName);
    try {
      await seedVolume(exName, { dir: seedDir, workdir: DEFAULT_WORKDIR });
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-out-'));
      try {
        const results = await extractFromVolume(exName, DEFAULT_WORKDIR, [
          { from: 'solo.txt', to: path.join(out, 'file-dest') },
          { from: 'results', to: path.join(out, 'dir-dest') },
          { from: 'missing-thing', to: path.join(out, 'nope') },
        ]);
        assert.equal(results.length, 3);
        assert.equal(results[0].status, 'ok');
        assert.equal(results[1].status, 'ok');
        assert.equal(results[2].status, 'missing');
        assert.equal(
          fs.readFileSync(path.join(out, 'file-dest', 'solo.txt'), 'utf8'),
          'hello',
        );
        assert.equal(
          fs.readFileSync(path.join(out, 'dir-dest', 'a.txt'), 'utf8'),
          'aaa',
        );
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(exName);
      fs.rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('rejects extract with path traversal', async () => {
    const exName = `light-runner-trav-${Date.now().toString(36)}`;
    await createVolume(exName, exName);
    try {
      await seedVolume(exName, { dir: undefined, workdir: DEFAULT_WORKDIR });
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-trav-'));
      try {
        const results = await extractFromVolume(exName, DEFAULT_WORKDIR, [
          { from: '../etc/passwd', to: path.join(out, 'x') },
        ]);
        assert.equal(results[0].status, 'error');
        assert.match(results[0].error ?? '', /traversal/);
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(exName);
    }
  });

  it('extracts a 5 MB file and reports accurate byte count', async () => {
    const n = `light-runner-5mb-${Date.now().toString(36)}`;
    await createVolume(n, n);
    try {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-5mb-'));
      try {
        const payload = Buffer.alloc(5 * 1024 * 1024, 0x41);
        fs.writeFileSync(path.join(d, 'big.bin'), payload);
        await seedVolume(n, { dir: d, workdir: DEFAULT_WORKDIR });
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-5mb-out-'));
        try {
          const results = await extractFromVolume(n, DEFAULT_WORKDIR, [
            { from: 'big.bin', to: path.join(out, 'artefact') },
          ]);
          assert.equal(results[0].status, 'ok');
          assert.ok(results[0].bytes! > payload.length);
          const extracted = fs.readFileSync(path.join(out, 'artefact', 'big.bin'));
          assert.equal(extracted.length, payload.length);
          assert.equal(extracted[0], 0x41);
          assert.equal(extracted[extracted.length - 1], 0x41);
        } finally {
          fs.rmSync(out, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(n);
    }
  });

  it('extract auto-creates missing parent directories on the host', async () => {
    const n = `light-runner-mkd-${Date.now().toString(36)}`;
    await createVolume(n, n);
    try {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-mkd-'));
      try {
        fs.writeFileSync(path.join(d, 'a.txt'), 'data');
        await seedVolume(n, { dir: d, workdir: DEFAULT_WORKDIR });
        const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-mkd-out-'));
        try {
          const deeply = path.join(outRoot, 'x', 'y', 'z');
          const results = await extractFromVolume(n, DEFAULT_WORKDIR, [
            { from: 'a.txt', to: deeply },
          ]);
          assert.equal(results[0].status, 'ok');
          assert.equal(fs.readFileSync(path.join(deeply, 'a.txt'), 'utf8'), 'data');
        } finally {
          fs.rmSync(outRoot, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(n);
    }
  });

  it('extract reports error when destination exists as a file', async () => {
    const n = `light-runner-coll-${Date.now().toString(36)}`;
    await createVolume(n, n);
    try {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-coll-'));
      try {
        fs.writeFileSync(path.join(d, 'a.txt'), 'data');
        await seedVolume(n, { dir: d, workdir: DEFAULT_WORKDIR });
        const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-coll-out-'));
        try {
          const conflict = path.join(outRoot, 'iamfile');
          fs.writeFileSync(conflict, 'existing');
          const results = await extractFromVolume(n, DEFAULT_WORKDIR, [
            { from: 'a.txt', to: conflict },
          ]);
          assert.equal(results[0].status, 'error');
          assert.ok(results[0].error);
        } finally {
          fs.rmSync(outRoot, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(n);
    }
  });

  it('extract rejects empty from/to', async () => {
    const n = `light-runner-empty-ex-${Date.now().toString(36)}`;
    await createVolume(n, n);
    try {
      await seedVolume(n, { dir: undefined, workdir: DEFAULT_WORKDIR });
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-empty-ex-'));
      try {
        const results = await extractFromVolume(n, DEFAULT_WORKDIR, [
          { from: '', to: path.join(outDir, 'x') },
          { from: 'a.txt', to: '' },
        ]);
        assert.equal(results[0].status, 'error');
        assert.equal(results[1].status, 'error');
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    } finally {
      await destroyVolume(n);
    }
  });
});
