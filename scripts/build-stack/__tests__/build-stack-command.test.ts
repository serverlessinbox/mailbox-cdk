import { Cli, type CommandClass }                 from 'clipanion';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir }                                 from 'node:os';
import * as path                                  from 'node:path';
import { Writable }                               from 'node:stream';

import { COGNITO_DATA_STACK_TEMPLATE_OBJECT }     from '../../../packages/mailbox-cognito/src/data-stack/mailbox-cognito-data-stack-contract';
import { BuildCognitoDataStackCommand }           from '../build-cognito-data-stack-command';
import { BuildDataStackCommand }                  from '../build-data-stack-command';
import { BuildEdgeStackCommand }                  from '../build-edge-stack-command';

/**
 * Pins the build-stack contract of each subcommand: it writes exactly its template into the `--out-dir`
 * it was given, reports the written path on stdout, and writes a JSON object with a `Resources` key. A
 * missing `--out-dir` fails, because the command has no hidden default folder.
 */
describe('build-stack subcommands', () => {
  const SYNTH_TIMEOUT_MILLIS = 300_000;

  const SUBCOMMANDS: ReadonlyArray<{ name: string; command: CommandClass; fileName: string }> = [
    { name: 'data',        command: BuildDataStackCommand,        fileName: 'data-stack-template.json' },
    { name: 'edge',        command: BuildEdgeStackCommand,        fileName: 'edge-stack-template.json' },
    { name: 'cognito-data', command: BuildCognitoDataStackCommand, fileName: COGNITO_DATA_STACK_TEMPLATE_OBJECT },
  ];

  it.each(SUBCOMMANDS)('writes the $name template into --out-dir', async ({ name, command, fileName }) => {
    const outDir           = mkdtempSync(path.join(tmpdir(), 'build-stack-command-'));
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await Cli.from([command]).run([name, '--out-dir', outDir], {
      stdout: collectingStream(stdout),
      stderr: collectingStream(stderr),
    });

    const templatePath = path.join(outDir, fileName);
    const templateText = readFileSync(templatePath, 'utf8');
    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(readdirSync(outDir)).toEqual([fileName]);
    expect(stdout.join('')).toBe(`Written: ${templatePath}\n`);
    expect(templateText.endsWith('\n')).toBe(true);
    expect(JSON.parse(templateText)).toHaveProperty('Resources');
  }, SYNTH_TIMEOUT_MILLIS);

  it('fails when --out-dir is missing', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await Cli.from([BuildDataStackCommand]).run(['data'], {
      stdout: collectingStream(stdout),
      stderr: collectingStream(stderr),
    });

    expect(exitCode).not.toBe(0);
    expect(stdout.join('') + stderr.join('')).toContain('--out-dir');
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
