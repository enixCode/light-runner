import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDockerArgs } from '../../src/args.js';
import {
  DANGEROUS_CAPS,
  DEFAULT_CPUS,
  DEFAULT_MEMORY,
  DEFAULT_WORKDIR,
  ISOLATED_NETWORK,
} from '../../src/constants.js';

function base() {
  return {
    options: {},
    containerName: 'light-runner-abc',
    volumeName: 'light-runner-abc',
    workdir: DEFAULT_WORKDIR,
  };
}

describe('buildDockerArgs', () => {
  it('includes run --rm -i and name', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    assert.deepEqual(args.slice(0, 5), ['run', '--rm', '-i', '--name', 'light-runner-abc']);
  });

  it('applies no-new-privileges and drops dangerous caps', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    assert.ok(args.includes('--security-opt'));
    assert.ok(args.includes('no-new-privileges'));
    for (const cap of DANGEROUS_CAPS) {
      const idx = args.indexOf('--cap-drop');
      assert.notEqual(idx, -1);
      assert.ok(args.includes(cap), `missing cap drop: ${cap}`);
    }
  });

  it('defaults to isolated network', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    const idx = args.indexOf('--network');
    assert.equal(args[idx + 1], ISOLATED_NETWORK);
  });

  it('passes through "none" to disable networking', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine', network: 'none' } });
    const idx = args.indexOf('--network');
    assert.equal(args[idx + 1], 'none');
  });

  it('includes memory and cpus when options set', () => {
    const args = buildDockerArgs({
      ...base(),
      options: { memory: '256m', cpus: '2.0' },
      request: { image: 'alpine' },
    });
    assert.ok(args.includes('--memory'));
    assert.ok(args.includes('256m'));
    assert.ok(args.includes('--cpus'));
    assert.ok(args.includes('2.0'));
  });

  it('applies default memory and cpus when options omitted', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    const memIdx = args.indexOf('--memory');
    const cpuIdx = args.indexOf('--cpus');
    assert.notEqual(memIdx, -1);
    assert.notEqual(cpuIdx, -1);
    assert.equal(args[memIdx + 1], DEFAULT_MEMORY);
    assert.equal(args[cpuIdx + 1], DEFAULT_CPUS);
  });

  it('passes env vars from request.env', () => {
    const args = buildDockerArgs({
      ...base(),
      request: { image: 'alpine', env: { FOO: 'bar' } },
    });
    assert.ok(args.includes('FOO=bar'));
  });

  it('overrides entrypoint to sh and passes -c script when command is set', () => {
    const args = buildDockerArgs({
      ...base(),
      request: { image: 'alpine', command: 'echo hi' },
    });
    const entIdx = args.indexOf('--entrypoint');
    assert.notEqual(entIdx, -1);
    assert.equal(args[entIdx + 1], 'sh');
    assert.equal(args[args.length - 2], '-c');
    assert.equal(args[args.length - 1], 'echo hi');
    assert.equal(args[args.length - 3], 'alpine');
  });

  it('omits --entrypoint and -c when no command', () => {
    const args = buildDockerArgs({
      ...base(),
      request: { image: 'alpine' },
    });
    assert.equal(args.indexOf('--entrypoint'), -1);
    assert.equal(args[args.length - 1], 'alpine');
  });

  it('always includes --pids-limit', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    const idx = args.indexOf('--pids-limit');
    assert.notEqual(idx, -1);
    assert.equal(args[idx + 1], '100');
  });

  it('throws on invalid gpus values (shell injection attempt)', () => {
    for (const bad of ['; rm -rf /', '$(id)', '`whoami`', '-all', '|ls', 'a&b', 'x>y']) {
      assert.throws(
        () => buildDockerArgs({ ...base(), options: { gpus: bad }, request: { image: 'alpine' } }),
        /invalid gpus/,
        `expected throw for ${JSON.stringify(bad)}`,
      );
    }
  });

  it('treats empty gpus as not set (no --gpus flag)', () => {
    const args = buildDockerArgs({
      ...base(),
      options: { gpus: '' },
      request: { image: 'alpine' },
    });
    assert.equal(args.indexOf('--gpus'), -1);
  });

  it('accepts safe gpus values', () => {
    for (const good of ['all', '0', '0,1', 'device=0', '"device=0,1"']) {
      const args = buildDockerArgs({
        ...base(),
        options: { gpus: good },
        request: { image: 'alpine' },
      });
      const idx = args.indexOf('--gpus');
      assert.notEqual(idx, -1);
      assert.equal(args[idx + 1], good);
    }
  });

  it('silently skips env vars with invalid names', () => {
    const args = buildDockerArgs({
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
    assert.ok(args.includes('GOOD_NAME=ok'));
    assert.ok(!args.some((a) => a.startsWith('1BAD=')));
    assert.ok(!args.some((a) => a.startsWith('BAD-NAME=')));
    assert.ok(!args.some((a) => a.startsWith('BAD NAME=')));
    assert.ok(!args.some((a) => a.startsWith('BAD;NAME=')));
    assert.ok(!args.some((a) => a === '='));
  });

  it('passes --runtime for runsc and kata but not runc', () => {
    const runc = buildDockerArgs({
      ...base(),
      options: { runtime: 'runc' },
      request: { image: 'alpine' },
    });
    assert.equal(runc.indexOf('--runtime'), -1);

    const runsc = buildDockerArgs({
      ...base(),
      options: { runtime: 'runsc' },
      request: { image: 'alpine' },
    });
    const i1 = runsc.indexOf('--runtime');
    assert.notEqual(i1, -1);
    assert.equal(runsc[i1 + 1], 'runsc');

    const kata = buildDockerArgs({
      ...base(),
      options: { runtime: 'kata' },
      request: { image: 'alpine' },
    });
    const i2 = kata.indexOf('--runtime');
    assert.notEqual(i2, -1);
    assert.equal(kata[i2 + 1], 'kata');
  });

  it('includes workdir via -w and volume via -v', () => {
    const args = buildDockerArgs({
      ...base(),
      workdir: '/custom-work',
      request: { image: 'alpine' },
    });
    const vIdx = args.indexOf('-v');
    const wIdx = args.indexOf('-w');
    assert.equal(args[vIdx + 1], 'light-runner-abc:/custom-work');
    assert.equal(args[wIdx + 1], '/custom-work');
  });

  it('disables no-new-privileges when explicitly set false', () => {
    const args = buildDockerArgs({
      ...base(),
      options: { noNewPrivileges: false },
      request: { image: 'alpine' },
    });
    const secIdxs = args
      .map((a, i) => (a === '--security-opt' ? i : -1))
      .filter((i) => i !== -1);
    assert.ok(
      !secIdxs.some((i) => args[i + 1] === 'no-new-privileges'),
      'no-new-privileges should not be present',
    );
  });

  it('drops every cap in DANGEROUS_CAPS exactly once', () => {
    const args = buildDockerArgs({ ...base(), request: { image: 'alpine' } });
    for (const cap of DANGEROUS_CAPS) {
      const count = args.filter((a) => a === cap).length;
      assert.equal(count, 1, `cap ${cap} should appear exactly once`);
    }
  });

  it('swaps --rm -i for -d when detached is true', () => {
    const args = buildDockerArgs({
      ...base(),
      request: { image: 'alpine' },
      detached: true,
    });
    assert.deepEqual(args.slice(0, 4), ['run', '-d', '--name', 'light-runner-abc']);
    assert.ok(!args.includes('--rm'), 'detached runs must not use --rm');
    assert.ok(!args.includes('-i'), 'detached runs must not attach stdin');
  });

  it('keeps every security flag when detached', () => {
    const args = buildDockerArgs({
      ...base(),
      request: { image: 'alpine' },
      detached: true,
    });
    // hardening invariants still apply in detached mode
    assert.ok(args.includes('--security-opt'));
    assert.ok(args.includes('no-new-privileges'));
    assert.ok(args.includes('--pids-limit'));
    assert.ok(args.includes('--memory'));
    assert.ok(args.includes('--cpus'));
    for (const cap of DANGEROUS_CAPS) assert.ok(args.includes(cap));
  });
});
