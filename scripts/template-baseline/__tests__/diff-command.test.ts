import { Cli }                 from 'clipanion';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import * as path               from 'node:path';
import { Writable }            from 'node:stream';

import { BaselineStore }       from '../baseline-store';
import { BaselineSynthesizer } from '../baseline-synthesizer';
import { DiffCommand }         from '../diff-command';
import type { StackTemplate }  from '../stack-template';

/**
 * Pins what the refactor gate reads from `diff`: exit 0 for a baseline that matches the synth, exit 1
 * with each stack's report layout when one differs (every stack is still reported), and exit 2 when the
 * baseline cannot be read. The synthesis is stubbed with two small templates; what counts as added,
 * removed or changed belongs to `TemplateDiffer`.
 */
describe('DiffCommand', () => {
  const synthesized: StackTemplate[]   = [
    { stackName: 'alpha', template: { Resources: { Kept: { Type: 'AWS::SNS::Topic' }, Added: { Type: 'AWS::SQS::Queue' }, Changed: { Type: 'AWS::S3::Bucket' } } } },
    { stackName: 'beta', template: { Resources: { Same: { Type: 'AWS::SNS::Topic' } } } },
  ];
  const baselineOfAlpha: StackTemplate = {
    stackName: 'alpha',
    template:  { Resources: { Kept: { Type: 'AWS::SNS::Topic' }, Removed: { Type: 'AWS::SQS::Queue' }, Changed: { Type: 'AWS::DynamoDB::Table' } } },
  };

  let baselineRoot: string;

  beforeEach(async () => {
    baselineRoot = mkdtempSync(path.join(tmpdir(), 'diff-command-'));
    jest.spyOn(BaselineSynthesizer.prototype, 'synthesize').mockReturnValue(synthesized);

    const store = new BaselineStore(baselineRoot);
    await store.write('base', synthesized);
    await store.write('tampered', [baselineOfAlpha, synthesized[1]]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(baselineRoot, { recursive: true, force: true });
  });

  it('exits 0 and reports every stack identical when the baseline matches the synth', async () => {
    const run = await runCli(['diff', '--label', 'base', '--baseline-root', baselineRoot]);

    expect(run).toEqual({ exitCode: 0, stdout: 'alpha: identical\nbeta: identical\n', stderr: '' });
  });

  it('exits 1 and reports the stack that differs, then the stacks after it', async () => {
    const run = await runCli(['diff', '--label', 'tampered', '--baseline-root', baselineRoot]);

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n')).toEqual([
      'alpha: DIFFERENT',
      '  added (1):',
      '    Resources/Added',
      '  removed (1):',
      '    Resources/Removed',
      '  changed (1):',
      '    Resources/Changed',
      '      Type',
      'beta: identical',
      '',
    ]);
  });

  it('exits 2 and reports the missing baseline on stderr when the label has no baseline', async () => {
    const run = await runCli(['diff', '--label', 'missing', '--baseline-root', baselineRoot]);

    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^template-baseline diff failed: /);
    expect(run.stderr).toContain(path.join(baselineRoot, 'missing', 'alpha.template.json'));
  });
});

interface CliRun {
  readonly exitCode: number;
  readonly stdout:   string;
  readonly stderr:   string;
}

async function runCli(argv: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode         = await Cli.from([DiffCommand]).run(argv, {
    stdout: collectingStream(stdout),
    stderr: collectingStream(stderr),
  });
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
}

/** A writable stream that appends every chunk written to it to `chunks`. */
function collectingStream(chunks: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
}
