import { Cli }                                       from 'clipanion';
import { mkdtempSync, rmSync, writeFileSync }        from 'node:fs';
import { tmpdir }                                    from 'node:os';
import * as path                                     from 'node:path';
import { Writable }                                  from 'node:stream';

import { DeclarationReporter }                       from '../declaration-reporter';
import { DiffCommand }                               from '../diff-command';

/**
 * Pins the API gate's verdict: exit 0 when the stored baseline equals the current report, exit 1
 * naming the baseline file when the surface differs, and a rejection that says to capture first when
 * the baseline cannot be read. The report itself belongs to `DeclarationReporter`, which is stubbed.
 */
describe('DiffCommand', () => {
  let packageDir: string;
  let baselinePath: string;

  async function runDiff(): Promise<{ exitCode: number; stdout: string }> {
    const chunks: string[] = [];
    const stdout           = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const command          = Cli.from([DiffCommand]).process(['diff', '--package', packageDir], { stdout });
    const exitCode         = await command.validateAndExecute();
    return { exitCode, stdout: chunks.join('') };
  }

  beforeEach(() => {
    packageDir   = mkdtempSync(path.join(tmpdir(), 'api-report-diff-'));
    baselinePath = path.join(packageDir, 'api-report.d.txt');
    jest.spyOn(DeclarationReporter.prototype, 'report').mockReturnValue('// index.d.ts\nexport declare const a: string;\n');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(packageDir, { recursive: true, force: true });
  });

  it('exits 0 when the baseline equals the current report', async () => {
    writeFileSync(baselinePath, '// index.d.ts\nexport declare const a: string;\n');

    await expect(runDiff()).resolves.toEqual({ exitCode: 0, stdout: 'The public API matches the baseline.\n' });
  });

  it('exits 1 naming the baseline file when the current report differs', async () => {
    writeFileSync(baselinePath, '// index.d.ts\nexport declare const a: number;\n');

    await expect(runDiff()).resolves.toEqual({
      exitCode: 1,
      stdout:   `The public API differs from ${baselinePath}. Run "yarn api-report capture" once the change is approved.\n`,
    });
  });

  it('rejects, telling to capture first, when there is no baseline', async () => {
    await expect(runDiff()).rejects.toThrow(`Cannot read the API baseline ${baselinePath} (`);
    await expect(runDiff()).rejects.toThrow('run "yarn api-report capture" first');
  });
});
