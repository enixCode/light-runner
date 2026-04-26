import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { Duplex, Readable } from 'node:stream';
import { create as createTar } from 'tar';
import { DEFAULT_IGNORES, SEEDER_IMAGE } from '../constants.js';
import { docker } from '../docker.js';
import { LightRunnerError } from '../errors.js';
import { shellQuote } from './seeder.js';

export interface SeedOptions {
  dir: string | undefined;
  workdir: string;
}

/*
 * Seed `workdir` inside the named volume with the contents of `dir`. We spin
 * up a throwaway alpine container that reads a tar stream on stdin and
 * extracts it under workdir. The seeder pattern is used (instead of bind
 * mounts) so the same code path works on Windows + Docker Desktop, where
 * host bind mounts have rights / line-ending quirks.
 */
export async function seedVolume(name: string, { workdir, dir }: SeedOptions): Promise<void> {
  // Empty volume: nothing to extract. Spawning the seeder with an empty
  // stream makes busybox tar fail with "short read", so skip outright.
  if (dir === undefined) return;

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`dir path not found: ${dir}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`dir path is not a directory: ${dir}`);
  }

  const wq = shellQuote(workdir);
  // Inline because we need hijacked stdin (seeder.ts helper is read-only).
  const container = await docker.createContainer({
    Image: SEEDER_IMAGE,
    Cmd: ['sh', '-c', `tar xf - -C ${wq} && chmod -R a+rwX ${wq}`],
    Tty: false,
    OpenStdin: true,
    StdinOnce: true,
    AttachStdin: true,
    AttachStdout: false,
    AttachStderr: true,
    HostConfig: {
      AutoRemove: true,
      Binds: [`${name}:${workdir}`],
    },
  });

  try {
    const stream = (await container.attach({
      stream: true,
      hijack: true,
      stdin: true,
      stdout: true,
      stderr: true,
    })) as Duplex;

    let stderrBuf = '';
    const stderrSink = new PassThrough();
    stderrSink.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });
    // Drain stdout: unread bytes would block the stream.
    const stdoutSink = new PassThrough();
    stdoutSink.on('data', () => {});

    container.modem.demuxStream(stream, stdoutSink, stderrSink);

    await container.start();

    const tarStream = createTar(
      {
        cwd: resolved,
        portable: true,
        follow: false,
        filter: (p, stat) => {
          // Skip symlinks: a symlink in the seed could point at sensitive
          // host paths that happen to exist in the container rootfs.
          if ((stat as fs.Stats | undefined)?.isSymbolicLink?.()) return false;
          return !p.split('/').some((s) => DEFAULT_IGNORES.has(s));
        },
      },
      ['.'],
    );

    await pipeAndEnd(tarStream as unknown as Readable, stream);

    const wait = (await container.wait()) as { StatusCode: number };
    if (wait.StatusCode !== 0) {
      throw new LightRunnerError({
        code: 'SEED_FAILED',
        message: `seeder exited ${wait.StatusCode}: ${stderrBuf.trim()}`,
        dockerOp: 'seedVolume',
      });
    }
  } catch (err) {
    if (err instanceof LightRunnerError) throw err;
    throw new LightRunnerError({
      code: 'SEED_FAILED',
      message: `seed failed: ${(err as Error).message}`,
      dockerOp: 'seedVolume',
      cause: err,
    });
  }
}

/*
 * Pipe `source` into `sink`, then half-close `sink` so the container reads EOF
 * on stdin and `tar xf -` exits. We resolve as soon as the source signals
 * `end`; per-write errors short-circuit the whole flow.
 */
function pipeAndEnd(source: Readable, sink: Duplex): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve();
    };
    source.on('error', done);
    sink.on('error', done);
    source.on('end', () => {
      try { sink.end(); } catch { /* sink may be half-closed already */ }
      done();
    });
    source.pipe(sink, { end: false });
  });
}
