import { Cli }                              from 'clipanion';
import { mkdtempSync }                      from 'node:fs';
import { tmpdir }                           from 'node:os';
import * as path                            from 'node:path';
import { Writable }                         from 'node:stream';

import { isJsonObjectNode }                 from '../../utils/json-value';
import type { JsonObject }                  from '../../utils/json-value';
import { BaselineStore }                    from '../baseline-store';
import { BaselineSynthesizer }              from '../baseline-synthesizer';
import { CaptureCommand }                   from '../capture-command';
import { DiffCommand }                      from '../diff-command';
import { FrozenProcessValues }              from '../frozen-process-values';
import type { StackTemplate }               from '../stack-template';

/** The data template after three planted differences, and the resource ids they touch. */
interface PlantedDifferences {
  readonly templates: StackTemplate[];
  /** A resource the baseline lacks: the fresh synth reports it as added. */
  readonly deletedId: string;
  /** A resource whose `Type` the baseline changes: the fresh synth reports it as changed. */
  readonly changedId: string;
}

/**
 * Pins what the refactor gate reads from `diff`: exit 0 for a baseline that matches the synth, exit 1
 * with each stack's added, removed and changed entries when one differs, and exit 2 when the baseline
 * cannot be read. Every case runs the real synthesizer against baselines written under a temporary
 * `--baseline-root`, so the repository's own `.template-baseline` is never read or written.
 */
describe('DiffCommand', () => {
  const SYNTH_TIMEOUT_MILLIS = 300_000;

  let baselineRoot: string;
  let planted: PlantedDifferences;

  beforeAll(async () => {
    baselineRoot    = mkdtempSync(path.join(tmpdir(), 'diff-command-'));
    const templates = new BaselineSynthesizer(FrozenProcessValues.forBaseline()).synthesize();
    planted         = plantDataDifferences(templates);

    const store = new BaselineStore(baselineRoot);
    await store.write('base', templates);
    await store.write('tampered', planted.templates);
  }, SYNTH_TIMEOUT_MILLIS);

  it('exits 0 and reports every stack identical when the baseline matches the synth', async () => {
    const run = await runCli(['diff', '--label', 'base', '--baseline-root', baselineRoot]);

    expect(run.exitCode).toBe(0);
    expect(lines(run.stdout)).toEqual(['mailbox: identical', 'edge: identical', 'data: identical', 'cognito-data: identical']);
    expect(run.stderr).toBe('');
  }, SYNTH_TIMEOUT_MILLIS);

  it('exits 1 and lists the added, removed and changed entries of the stack that differs', async () => {
    const run = await runCli(['diff', '--label', 'tampered', '--baseline-root', baselineRoot]);

    expect(run.exitCode).toBe(1);
    expect(lines(run.stdout)).toEqual([
      'mailbox: identical',
      'edge: identical',
      'data: DIFFERENT',
      '  added (1):',
      `    Resources/${planted.deletedId}`,
      '  removed (1):',
      '    Resources/PlantedEntry',
      '  changed (1):',
      `    Resources/${planted.changedId}`,
      '      Type',
      'cognito-data: identical',
    ]);
    expect(run.stderr).toBe('');
  }, SYNTH_TIMEOUT_MILLIS);

  it('exits 2 and reports the missing baseline on stderr when the label has no baseline', async () => {
    const run = await runCli(['diff', '--label', 'missing', '--baseline-root', baselineRoot]);

    expect(run.exitCode).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^template-baseline diff failed: /);
    expect(run.stderr).toContain(path.join(baselineRoot, 'missing', 'mailbox.template.json'));
  }, SYNTH_TIMEOUT_MILLIS);
});

/** Plants the three data-template differences in a copy of the synthesized templates; the input is not changed. */
function plantDataDifferences(templates: StackTemplate[]): PlantedDifferences {
  const dataStack = templates.find(({ stackName }) => stackName === 'data');
  if (dataStack === undefined) {
    throw new Error('The synthesizer produced no data template.');
  }
  const tampered = tamperResources(dataStack.template);
  return {
    templates: templates.map((stack) => (stack === dataStack ? { stackName: stack.stackName, template: tampered.template } : stack)),
    deletedId: tampered.deletedId,
    changedId: tampered.changedId,
  };
}

/** Removes the first resource, adds a planted entry and changes the `Type` of the second resource. */
function tamperResources(template: JsonObject): { template: JsonObject; deletedId: string; changedId: string } {
  const resources = template.Resources;
  if (!isJsonObjectNode(resources)) {
    throw new Error('The data template has no Resources object.');
  }
  const [deletedId, changedId]        = Object.keys(resources);
  const tamperedResources: JsonObject = structuredClone(resources);

  delete tamperedResources[deletedId];
  tamperedResources.PlantedEntry = { Type: 'AWS::SQS::Queue' };
  const changedEntry             = tamperedResources[changedId];
  if (!isJsonObjectNode(changedEntry)) {
    throw new Error(`Resource ${changedId} is not an object.`);
  }
  changedEntry.Type = 'AWS::Planted::Type';

  return { template: { ...template, Resources: tamperedResources }, deletedId, changedId };
}

interface CliRun {
  readonly exitCode: number;
  readonly stdout:   string;
  readonly stderr:   string;
}

async function runCli(argv: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode         = await Cli.from([CaptureCommand, DiffCommand]).run(argv, {
    stdout: collectingStream(stdout),
    stderr: collectingStream(stderr),
  });
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') };
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line !== '');
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
