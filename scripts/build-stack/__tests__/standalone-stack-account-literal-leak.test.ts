/**
 * Standalone sub-stack account-literal regression gate.
 *
 * The data, edge and cognito-data templates are published as customer artifacts, so none of them may
 * carry an account number. A construct that reads `Stack.of(this).account` writes a literal into the
 * template whenever its stack has an explicit `env`, and that is invisible to tsc, jsii and to unit tests
 * that build stacks with an explicit `env`. This test runs the real `build-stack` subcommands and scans
 * every template they write for any 12-digit run.
 *
 * The subcommands run with CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION set to a fake account and region,
 * so a subcommand that read those variables would write the fake account into its template.
 */
import { Cli, type CommandClass }                       from 'clipanion';
import { mkdtempSync, readdirSync, readFileSync }       from 'node:fs';
import { tmpdir }                                       from 'node:os';
import * as path                                        from 'node:path';
import { Writable }                                     from 'node:stream';

import { BuildCognitoDataStackCommand }                 from '../build-cognito-data-stack-command';
import { BuildDataStackCommand }                        from '../build-data-stack-command';
import { BuildEdgeStackCommand }                        from '../build-edge-stack-command';

const FAKE_ACCOUNT = '111122223333';
const FAKE_REGION  = 'eu-west-2';

const SYNTH_TIMEOUT_MILLIS = 300_000;

/** Matches a bare 12-digit run (an AWS account id is always exactly 12 digits). */
const ACCOUNT_SHAPED_LITERAL = /\d{12}/;

const SUBCOMMANDS: ReadonlyArray<{ name: string; command: CommandClass }> = [
  { name: 'data',         command: BuildDataStackCommand },
  { name: 'edge',         command: BuildEdgeStackCommand },
  { name: 'cognito-data', command: BuildCognitoDataStackCommand },
];

/**
 * Returns the JSON path of every key or string value in a synthesized template that holds a 12-digit
 * run. Keys are scanned as well as values, because a leaked account baked into a logical id is a key.
 */
function findAccountLiterals(node: unknown, nodePath = '$'): string[] {
  if (typeof node === 'string') {
    return ACCOUNT_SHAPED_LITERAL.test(node) ? [nodePath] : [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item: unknown, index: number) => findAccountLiterals(item, `${nodePath}[${index}]`));
  }

  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]: [string, unknown]) => [
      ...(ACCOUNT_SHAPED_LITERAL.test(key) ? [`${nodePath}.${key} (key)`] : []),
      ...findAccountLiterals(value, `${nodePath}.${key}`),
    ]);
  }

  return [];
}

/** Restores a variable to its value before the suite, or removes it when it was unset. */
function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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

describe('Standalone sub-stack account-literal leak (regression gate)', () => {
  const savedAccount = process.env.CDK_DEFAULT_ACCOUNT;
  const savedRegion  = process.env.CDK_DEFAULT_REGION;

  beforeAll(() => {
    process.env.CDK_DEFAULT_ACCOUNT = FAKE_ACCOUNT;
    process.env.CDK_DEFAULT_REGION  = FAKE_REGION;
  });

  afterAll(() => {
    restoreEnvironmentVariable('CDK_DEFAULT_ACCOUNT', savedAccount);
    restoreEnvironmentVariable('CDK_DEFAULT_REGION', savedRegion);
  });

  it('the scanner reports an account literal wherever it sits', () => {
    expect(findAccountLiterals({ Resources: { [FAKE_ACCOUNT]: { Value: FAKE_ACCOUNT } } })).toEqual([
      `$.Resources.${FAKE_ACCOUNT} (key)`,
      `$.Resources.${FAKE_ACCOUNT}.Value`,
    ]);
  });

  it.each(SUBCOMMANDS)('the $name template, written by build-stack, carries no account-shaped literal', async ({ name, command }) => {
    const outDir           = mkdtempSync(path.join(tmpdir(), 'build-stack-leak-'));
    const stderr: string[] = [];

    const exitCode = await Cli.from([command]).run([name, '--out-dir', outDir], {
      stdout: collectingStream([]),
      stderr: collectingStream(stderr),
    });

    const [fileName]        = readdirSync(outDir);
    const template: unknown = JSON.parse(readFileSync(path.join(outDir, fileName), 'utf8'));

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(findAccountLiterals(template)).toEqual([]);
  }, SYNTH_TIMEOUT_MILLIS);
});
