import { Cli }                      from 'clipanion';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir }                   from 'node:os';
import * as path                    from 'node:path';
import { Writable }                 from 'node:stream';

import { CaptureCommand }           from '../capture-command';
import { DiffCommand }              from '../diff-command';

/**
 * Pins that `capture` synthesizes the four stack templates and writes each one under the label folder
 * of `--baseline-root`, reporting one `Written:` line per file. A file written anywhere else, or a
 * missing stack, fails the baseline the refactor gate later compares against.
 */
describe('CaptureCommand', () => {
  const SYNTH_TIMEOUT_MILLIS = 300_000;
  const STACK_NAMES          = ['mailbox', 'edge', 'data', 'cognito-data'];

  it('writes the four stack templates under the label folder of --baseline-root', async () => {
    const root             = mkdtempSync(path.join(tmpdir(), 'capture-command-'));
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await Cli.from([CaptureCommand, DiffCommand]).run(
      ['capture', '--label', 'x', '--baseline-root', root],
      { stdout: collectingStream(stdout), stderr: collectingStream(stderr) },
    );

    const labelDirectory = path.join(root, 'x');
    const fileNames      = STACK_NAMES.map((stackName) => `${stackName}.template.json`);
    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(readdirSync(labelDirectory).sort()).toEqual([...fileNames].sort());
    expect(stdout.join('').split('\n').filter((line) => line !== '')).toEqual(
      fileNames.map((fileName) => `Written: ${path.join(labelDirectory, fileName)}`),
    );
  }, SYNTH_TIMEOUT_MILLIS);
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
