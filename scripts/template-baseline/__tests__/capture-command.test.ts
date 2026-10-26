import { Cli }                                            from 'clipanion';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir }                                         from 'node:os';
import * as path                                          from 'node:path';
import { Writable }                                       from 'node:stream';

import { BaselineSynthesizer }                            from '../baseline-synthesizer';
import { CaptureCommand }                                 from '../capture-command';
import type { StackTemplate }                             from '../stack-template';

/**
 * Pins that `capture` stores each synthesized template under the label folder of `--baseline-root`
 * and reports one `Written:` line per file. A file written anywhere else, or a template left out,
 * fails the baseline the refactor gate later compares against. The synthesis is stubbed: it belongs
 * to `BaselineSynthesizer`.
 */
describe('CaptureCommand', () => {
  const synthesized: StackTemplate[] = [
    { stackName: 'alpha', template: { Resources: { Topic: { Type: 'AWS::SNS::Topic' } } } },
    { stackName: 'beta', template: { Resources: {} } },
  ];
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'capture-command-'));
    jest.spyOn(BaselineSynthesizer.prototype, 'synthesize').mockReturnValue(synthesized);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('writes each synthesized template under the label folder of --baseline-root and reports each file', async () => {
    const stdout: string[] = [];

    const exitCode = await Cli.from([CaptureCommand]).run(
      ['capture', '--label', 'x', '--baseline-root', root],
      { stdout: collectingStream(stdout) },
    );

    const labelDirectory = path.join(root, 'x');
    expect(exitCode).toBe(0);
    expect(readdirSync(root)).toEqual(['x']);
    expect(readdirSync(labelDirectory).sort()).toEqual(['alpha.template.json', 'beta.template.json']);
    expect(JSON.parse(readFileSync(path.join(labelDirectory, 'alpha.template.json'), 'utf8'))).toEqual(synthesized[0].template);
    expect(stdout.join('')).toBe(
      `Written: ${path.join(labelDirectory, 'alpha.template.json')}\nWritten: ${path.join(labelDirectory, 'beta.template.json')}\n`,
    );
  });
});

/** A writable stream that appends every chunk written to it to `chunks`. */
function collectingStream(chunks: string[]): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
}
