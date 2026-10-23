import { build }                        from 'esbuild';
import { mkdtemp, rm, writeFile }       from 'fs/promises';
import { tmpdir }                       from 'os';
import { join }                         from 'path';

import { runWithInheritedStdio }        from '../../../utils/run-process';
import { typescriptDeclarationsPlugin } from '../typescript-declarations';

jest.mock('../../../utils/run-process');

const declarationCommand = ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'];

let packageFolder: string;
let cleanEntry: string;
let brokenEntry: string;

function buildEntry(entryPath: string) {
  return build({
    entryPoints: [entryPath],
    bundle:      true,
    write:       false,
    platform:    'node',
    plugins:     [typescriptDeclarationsPlugin(packageFolder)],
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(runWithInheritedStdio).mockResolvedValue(0);
  packageFolder = await mkdtemp(join(tmpdir(), 'typescript-declarations-test-'));
  cleanEntry    = join(packageFolder, 'clean.js');
  brokenEntry   = join(packageFolder, 'broken.js');
  await writeFile(cleanEntry, 'export const value = 1;');
  await writeFile(brokenEntry, 'export const = ;');
});

afterEach(async () => {
  await rm(packageFolder, { recursive: true, force: true });
});

describe('typescriptDeclarationsPlugin', () => {
  it('emits declarations with tsc, in the package folder, after a clean bundle', async () => {
    await buildEntry(cleanEntry);

    expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
    expect(runWithInheritedStdio).toHaveBeenCalledWith('yarn', declarationCommand, packageFolder);
  });

  it('emits nothing when the bundle has errors', async () => {
    await expect(buildEntry(brokenEntry)).rejects.toThrow();

    expect(runWithInheritedStdio).not.toHaveBeenCalled();
  });

  it('does not fail the build when tsc exits non-zero (BND-16, pinned current behaviour)', async () => {
    jest.mocked(runWithInheritedStdio).mockResolvedValue(2);

    await expect(buildEntry(cleanEntry)).resolves.toMatchObject({ errors: [] });
  });

  it('rejects the build when tsc cannot be started', async () => {
    jest.mocked(runWithInheritedStdio).mockRejectedValue(new Error('spawn yarn ENOENT'));

    await expect(buildEntry(cleanEntry)).rejects.toThrow('spawn yarn ENOENT');
  });
});
