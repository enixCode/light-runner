import { RUN_ID_LABEL, VOLUME_PREFIX } from '../constants.js';
import { docker } from '../docker.js';
import { LightRunnerError } from '../errors.js';

export async function createVolume(name: string, runId: string): Promise<void> {
  try {
    await docker.createVolume({
      Name: name,
      Labels: { [RUN_ID_LABEL]: runId },
    });
  } catch (err) {
    throw new LightRunnerError({
      code: 'VOLUME_CREATE_FAILED',
      message: `volume create failed: ${(err as Error).message}`,
      dockerOp: 'createVolume',
      cause: err,
    });
  }
}

export async function destroyVolume(name: string): Promise<void> {
  // Best-effort cleanup. Docker can race us (e.g. AutoRemove still tearing
  // down a mount), so we never escalate volume teardown failures - a leaked
  // volume gets reaped by reapOrphans().
  try {
    await docker.getVolume(name).remove({ force: true });
  } catch {
    /* swallow */
  }
}

export async function cleanupOrphanVolumes(): Promise<number> {
  let removed = 0;
  try {
    const list = await docker.listVolumes({
      filters: { name: [VOLUME_PREFIX] },
    });
    for (const v of list.Volumes ?? []) {
      try {
        await docker.getVolume(v.Name).remove();
        removed += 1;
      } catch {
        // in-use or already gone - leave it for the next sweep
      }
    }
  } catch {
    // listVolumes failure is non-fatal: caller treats 0 as "nothing reaped"
  }
  return removed;
}
