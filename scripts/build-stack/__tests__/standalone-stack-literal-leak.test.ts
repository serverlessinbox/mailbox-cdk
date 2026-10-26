/**
 * Standalone sub-stack account-and-region-literal regression gate.
 *
 * The data, edge and cognito-data templates are published as customer artifacts, so none of them may
 * carry an account number or a region name. A construct that reads `Stack.of(this).account` or
 * `.region` writes a literal into the template whenever its stack has an explicit `env`, and that is
 * invisible to tsc, jsii and to unit tests that build stacks with an explicit `env`. This test runs the
 * real `build-stack` subcommands and scans every template they write for any 12-digit run and, in
 * string values other than a `Description`, any region name.
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

/** Matches an AWS region name such as `eu-west-1` or `us-gov-west-1`. */
const REGION_SHAPED_LITERAL = /[a-z]{2}(-gov)?-[a-z]+-\d/;

/** What a literal scan matches: the pattern, whether keys count as well as values, and one key whose value is skipped. */
interface LiteralScan {
  readonly pattern:    RegExp;
  readonly scanKeys:   boolean;
  readonly skippedKey: string | undefined;
}

const SUBCOMMANDS:ReadonlyArray<{ name: string; command: CommandClass }> = [
  { name: 'data',         command: BuildDataStackCommand },
  { name: 'edge',         command: BuildEdgeStackCommand },
  { name: 'cognito-data', command: BuildCognitoDataStackCommand },
];

/**
 * Returns the JSON path of every key or string value in a synthesized template that holds a 12-digit
 * run. Keys are scanned as well as values, because a leaked account baked into a logical id is a key.
 */
function findAccountLiterals(node: unknown, nodePath = '$'): string[] {
  return findLiterals(node, { pattern: ACCOUNT_SHAPED_LITERAL, scanKeys: true, skippedKey: undefined }, nodePath);
}

/**
 * Returns the JSON path of every string value in a synthesized template that holds a region name. Keys
 * are not scanned: a key is a logical id or a property name, not a value written into a customer account.
 * A region named in a `Description` is prose for the reader, not a value, so it is not reported. A
 * `{"Ref":"AWS::Region"}` carries no region name, so it is not reported either.
 */
function findRegionLiterals(node: unknown, nodePath = '$'): string[] {
  return findLiterals(node, { pattern: REGION_SHAPED_LITERAL, scanKeys: false, skippedKey: 'Description' }, nodePath);
}

function findLiterals(node: unknown, scan: LiteralScan, nodePath: string): string[] {
  if (typeof node === 'string') {
    return scan.pattern.test(node) ? [nodePath] : [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item: unknown, index: number) => findLiterals(item, scan, `${nodePath}[${index}]`));
  }

  if (node !== null && typeof node === 'object') {
    return Object.entries(node)
      .filter(([key]: [string, unknown]) => key !== scan.skippedKey)
      .flatMap(([key, value]: [string, unknown]) => [
        ...(scan.scanKeys && scan.pattern.test(key) ? [`${nodePath}.${key} (key)`] : []),
        ...findLiterals(value, scan, `${nodePath}.${key}`),
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

describe('Standalone sub-stack account and region literal leak (regression gate)', () => {
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

  it('the scanner reports a region literal in a value, and not in a key or a region reference', () => {
    expect(findRegionLiterals({
      Resources: {
        'eu-west-1': {
          Literal:    'arn:aws:s3:::bucket-eu-west-1',
          GovLiteral: 'us-gov-west-1',
          Reference:  { Ref: 'AWS::Region' },
          Sub:        { 'Fn::Sub': 'arn:aws:sns:${AWS::Region}:${AWS::AccountId}:topic' },
        },
      },
    })).toEqual([
      '$.Resources.eu-west-1.Literal',
      '$.Resources.eu-west-1.GovLiteral',
    ]);
  });

  it('the scanner does not report a region named in a Description', () => {
    expect(findRegionLiterals({
      Parameters: { CertArn: { Description: 'ACM certificate (must be in us-east-1)', Default: 'eu-west-1' } },
    })).toEqual([
      '$.Parameters.CertArn.Default',
    ]);
  });

  it.each(SUBCOMMANDS)('the $name template, written by build-stack, carries no account-shaped or region literal', async ({ name, command }) => {
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
    expect(findRegionLiterals(template)).toEqual([]);
  }, SYNTH_TIMEOUT_MILLIS);
});
