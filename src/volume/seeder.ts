import type { Duplex } from 'node:stream';
import type Dockerode from 'dockerode';
import { SEEDER_IMAGE } from '../constants.js';
import { docker } from '../docker.js';

/*
 * Helpers shared by seed.ts and extract.ts. Both spawn a throwaway alpine
 * container with the named volume mounted at workdir, run a sh script, then
 * stream stdio back over a hijacked attach. Centralised here so the lifecycle
 * stays consistent (AutoRemove on, no TTY, demuxed streams).
 */

export function createSeederContainer(
  volumeName: string,
  workdir: string,
  script: string,
): Promise<Dockerode.Container> {
  return docker.createContainer({
    Image: SEEDER_IMAGE,
    Cmd: ['sh', '-c', script],
    Tty: false,
    HostConfig: {
      AutoRemove: true,
      Binds: [`${volumeName}:${workdir}`],
    },
  });
}

export function attachReadOnly(container: Dockerode.Container): Promise<Duplex> {
  return container.attach({
    stream: true,
    stdin: false,
    stdout: true,
    stderr: true,
  }) as Promise<Duplex>;
}

export function streamEnd(stream: Duplex): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.on('end', resolve);
    stream.on('close', resolve);
  });
}

/*
 * Wait for an AutoRemove container to exit. The `wait()` call can 404 when
 * AutoRemove tears the container down before we asked, so we treat that as
 * unknown-code (-1). Callers that need to disambiguate "real failure" from
 * "race" check the value before trusting it.
 */
export async function awaitContainerExit(container: Dockerode.Container): Promise<number> {
  try {
    const wait = (await container.wait()) as { StatusCode: number };
    return wait.StatusCode;
  } catch {
    return -1;
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
