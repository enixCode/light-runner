import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContainerCreateOptions } from '../../src/createOptions.js';
import {
  DANGEROUS_CAPS,
  DEFAULT_CPUS,
  DEFAULT_MEMORY,
  DEFAULT_PIDS_LIMIT,
  DEFAULT_WORKDIR,
  ISOLATED_NETWORK,
  RUN_ID_LABEL,
} from '../../src/constants.js';

function base() {
  return {
    options: {},
    containerName: 'light-runner-abc',
    volumeName: 'light-runner-abc',
    workdir: DEFAULT_WORKDIR,
    runId: 'light-runner-abc',
  };
}

function memBytes(s: string): number {
  const m = /^(\d+)([kmg])?$/i.exec(s)!;
  const n = Number.parseInt(m[1]!, 10);
  const u = (m[2] ?? '').toLowerCase();
  return u === 'g' ? n * 1024 ** 3 : u === 'm' ? n * 1024 ** 2 : u === 'k' ? n * 1024 : n;
}

describe('buildContainerCreateOptions', () => {
  it('sets name + image + workdir + label', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.equal(o.name, 'light-runner-abc');
    assert.equal(o.Image, 'alpine');
    assert.equal(o.WorkingDir, DEFAULT_WORKDIR);
    assert.equal(o.Labels?.[RUN_ID_LABEL], 'light-runner-abc');
  });

  it('applies no-new-privileges and drops dangerous caps', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.deepEqual(o.HostConfig?.SecurityOpt, ['no-new-privileges']);
    for (const cap of DANGEROUS_CAPS) {
      assert.ok(
        (o.HostConfig?.CapDrop as string[]).includes(cap),
        `missing cap drop: ${cap}`,
      );
    }
  });

  it('defaults to isolated network', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.equal(o.HostConfig?.NetworkMode, ISOLATED_NETWORK);
  });

  it('passes through "none" to disable networking', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine', network: 'none' },
    });
    assert.equal(o.HostConfig?.NetworkMode, 'none');
  });

  it('parses memory + cpus to dockerode units', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      options: { memory: '256m', cpus: '2.0' },
      request: { image: 'alpine' },
    });
    assert.equal(o.HostConfig?.Memory, 256 * 1024 * 1024);
    assert.equal(o.HostConfig?.NanoCpus, 2_000_000_000);
  });

  it('applies default memory and cpus when options omitted', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.equal(o.HostConfig?.Memory, memBytes(DEFAULT_MEMORY));
    assert.equal(o.HostConfig?.NanoCpus, Math.round(parseFloat(DEFAULT_CPUS) * 1e9));
  });

  it('passes env vars from request.env', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine', env: { FOO: 'bar' } },
    });
    assert.ok((o.Env ?? []).includes('FOO=bar'));
  });

  it('overrides entrypoint to sh and passes -c script when command is set', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine', command: 'echo hi' },
    });
    assert.deepEqual(o.Entrypoint, ['sh']);
    assert.deepEqual(o.Cmd, ['-c', 'echo hi']);
  });

  it('omits Entrypoint and Cmd when no command', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine' },
    });
    assert.equal(o.Entrypoint, undefined);
    assert.equal(o.Cmd, undefined);
  });

  it('always includes PidsLimit', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.equal(o.HostConfig?.PidsLimit, DEFAULT_PIDS_LIMIT);
  });

  it('throws on invalid gpus values (shell injection attempt)', () => {
    for (const bad of ['; rm -rf /', '$(id)', '`whoami`', '-all', '|ls', 'a&b', 'x>y']) {
      assert.throws(
        () =>
          buildContainerCreateOptions({
            ...base(),
            options: { gpus: bad },
            request: { image: 'alpine' },
          }),
        /invalid gpus/,
        `expected throw for ${JSON.stringify(bad)}`,
      );
    }
  });

  it('treats empty gpus as not set (no DeviceRequests)', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      options: { gpus: '' },
      request: { image: 'alpine' },
    });
    assert.equal(o.HostConfig?.DeviceRequests, undefined);
  });

  it('translates safe gpus values into DeviceRequests', () => {
    for (const good of ['all', '0', '0,1', 'device=0', '"device=0,1"']) {
      const o = buildContainerCreateOptions({
        ...base(),
        options: { gpus: good },
        request: { image: 'alpine' },
      });
      assert.ok(o.HostConfig?.DeviceRequests, `expected DeviceRequests for ${good}`);
      assert.equal(o.HostConfig?.DeviceRequests?.length, 1);
      assert.equal(o.HostConfig?.DeviceRequests?.[0]?.Driver, 'nvidia');
    }
  });

  it('silently skips env vars with invalid names', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: {
        image: 'alpine',
        env: {
          'GOOD_NAME': 'ok',
          '1BAD': 'fail',
          'BAD-NAME': 'fail',
          'BAD NAME': 'fail',
          'BAD;NAME': 'fail',
          '': 'fail',
        },
      },
    });
    const env = o.Env ?? [];
    assert.ok(env.includes('GOOD_NAME=ok'));
    assert.ok(!env.some((a) => a.startsWith('1BAD=')));
    assert.ok(!env.some((a) => a.startsWith('BAD-NAME=')));
    assert.ok(!env.some((a) => a.startsWith('BAD NAME=')));
    assert.ok(!env.some((a) => a.startsWith('BAD;NAME=')));
    assert.ok(!env.some((a) => a === '='));
  });

  it('passes Runtime for runsc and kata but not runc', () => {
    const runc = buildContainerCreateOptions({
      ...base(),
      options: { runtime: 'runc' },
      request: { image: 'alpine' },
    });
    assert.equal(runc.HostConfig?.Runtime, undefined);

    const runsc = buildContainerCreateOptions({
      ...base(),
      options: { runtime: 'runsc' },
      request: { image: 'alpine' },
    });
    assert.equal(runsc.HostConfig?.Runtime, 'runsc');

    const kata = buildContainerCreateOptions({
      ...base(),
      options: { runtime: 'kata' },
      request: { image: 'alpine' },
    });
    assert.equal(kata.HostConfig?.Runtime, 'kata');
  });

  it('binds the volume to the workdir', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      workdir: '/custom-work',
      request: { image: 'alpine' },
    });
    assert.deepEqual(o.HostConfig?.Binds, ['light-runner-abc:/custom-work']);
    assert.equal(o.WorkingDir, '/custom-work');
  });

  it('disables no-new-privileges when explicitly set false', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      options: { noNewPrivileges: false },
      request: { image: 'alpine' },
    });
    assert.deepEqual(o.HostConfig?.SecurityOpt, []);
  });

  it('drops every cap in DANGEROUS_CAPS exactly once', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    const drops = o.HostConfig?.CapDrop as string[];
    for (const cap of DANGEROUS_CAPS) {
      const count = drops.filter((c) => c === cap).length;
      assert.equal(count, 1, `cap ${cap} should appear exactly once`);
    }
  });

  it('detached: AutoRemove off, no stdio attach', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine' },
      detached: true,
    });
    assert.equal(o.HostConfig?.AutoRemove, false);
    assert.equal(o.AttachStdin, false);
    assert.equal(o.AttachStdout, false);
    assert.equal(o.AttachStderr, false);
    assert.equal(o.OpenStdin, false);
  });

  it('attached: AutoRemove on, stdout/stderr attached', () => {
    const o = buildContainerCreateOptions({ ...base(), request: { image: 'alpine' } });
    assert.equal(o.HostConfig?.AutoRemove, true);
    assert.equal(o.AttachStdout, true);
    assert.equal(o.AttachStderr, true);
  });

  it('attached + input: opens stdin', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine', input: { foo: 1 } },
    });
    assert.equal(o.OpenStdin, true);
    assert.equal(o.StdinOnce, true);
    assert.equal(o.AttachStdin, true);
  });

  it('keeps every security flag when detached', () => {
    const o = buildContainerCreateOptions({
      ...base(),
      request: { image: 'alpine' },
      detached: true,
    });
    assert.deepEqual(o.HostConfig?.SecurityOpt, ['no-new-privileges']);
    assert.equal(o.HostConfig?.PidsLimit, DEFAULT_PIDS_LIMIT);
    assert.ok((o.HostConfig?.Memory ?? 0) > 0);
    assert.ok((o.HostConfig?.NanoCpus ?? 0) > 0);
    for (const cap of DANGEROUS_CAPS) {
      assert.ok((o.HostConfig?.CapDrop as string[]).includes(cap));
    }
  });
});
