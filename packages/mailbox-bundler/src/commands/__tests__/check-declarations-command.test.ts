import { Cli }                          from 'clipanion';
import { PassThrough }                  from 'stream';

import { DeclarationClosureChecker }    from '../../jsii-package/declaration-closure-checker';
import { CheckDeclarationsCommand }     from '../check-declarations-command';

jest.mock('../../jsii-package/declaration-closure-checker');

const cli = Cli.from([CheckDeclarationsCommand]);

interface CommandRun {
  readonly exitCode: number;
  readonly output:   string;
}

async function runCommand(packageFolder: string): Promise<CommandRun> {
  const stdout   = new PassThrough();
  const exitCode = await cli.run(['check-declarations', packageFolder], { stdout });
  return { exitCode, output: String(stdout.read() ?? '') };
}

function stubChecker(violations: string[], outside: number): void {
  jest.mocked(DeclarationClosureChecker.prototype.check).mockResolvedValue(violations);
  jest.mocked(DeclarationClosureChecker.prototype.countUndeclaredOutsideClosure).mockResolvedValue(outside);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CheckDeclarationsCommand', () => {
  it('exits 0 when the closure has no violation', async () => {
    stubChecker([], 0);

    await expect(runCommand('pkg')).resolves.toMatchObject({ exitCode: 0 });
  });

  it('exits 1 and prints every violation, then the count outside the closure', async () => {
    stubChecker(["lib/index.d.ts imports 'typanion', which is undeclared", "lib/a.d.ts imports 'b', which is undeclared"], 3);

    const run = await runCommand('pkg');

    expect(run.exitCode).toBe(1);
    expect(run.output).toBe([
      "lib/index.d.ts imports 'typanion', which is undeclared",
      "lib/a.d.ts imports 'b', which is undeclared",
      '3 more declaration file(s) outside the closure also name an undeclared package.',
      '',
    ].join('\n'));
  });

  it('checks the package folder resolved against the current directory', async () => {
    stubChecker([], 0);

    await runCommand('pkg');

    expect(DeclarationClosureChecker).toHaveBeenCalledWith(expect.stringMatching(/[\\/]pkg$/));
  });
});
