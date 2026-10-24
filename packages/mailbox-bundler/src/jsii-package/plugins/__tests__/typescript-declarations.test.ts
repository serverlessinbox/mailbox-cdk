import { build }                        from 'esbuild';
import type { Message }                 from 'esbuild';
import { mkdtemp, rm, writeFile }       from 'fs/promises';
import { tmpdir }                       from 'os';
import { join }                         from 'path';

import { runWithInheritedStdio }        from '../../../utils/run-process';
import { typescriptDeclarationsPlugin } from '../typescript-declarations';

import { StubPluginBuild }              from './stub-plugin-build';

jest.mock('../../../utils/run-process');

const declarationCommand = ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'];
const stubPackageFolder  = '/r/typescript-declarations';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(runWithInheritedStdio).mockResolvedValue(0);
});

describe('typescriptDeclarationsPlugin', () => {
  describe('bundled output', () => {
    let packageFolder: string;

    beforeEach(async () => {
      packageFolder = await mkdtemp(join(tmpdir(), 'typescript-declarations-test-'));
      await writeFile(join(packageFolder, 'clean.js'), 'export const value = 1;');
    });

    afterEach(async () => {
      await rm(packageFolder, { recursive: true, force: true });
    });

    it('emits declarations with tsc, in the package folder, after a clean bundle', async () => {
      await build({
        entryPoints: [join(packageFolder, 'clean.js')],
        bundle:      true,
        write:       false,
        platform:    'node',
        plugins:     [typescriptDeclarationsPlugin(packageFolder)],
      });

      expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
      expect(runWithInheritedStdio).toHaveBeenCalledWith('yarn', declarationCommand, packageFolder);
    });
  });

  describe('onEnd decisions', () => {
    let stub: StubPluginBuild;

    beforeEach(() => {
      stub = new StubPluginBuild();
      stub.registerPlugin(typescriptDeclarationsPlugin(stubPackageFolder));
    });

    it('emits nothing when the bundle has errors', async () => {
      const bundleError: Message = { id: '', pluginName: '', text: 'Unexpected token', location: null, notes: [], detail: undefined };

      await stub.end([bundleError]);

      expect(runWithInheritedStdio).not.toHaveBeenCalled();
    });

    it('does not fail the build when tsc exits non-zero (BND-16, pinned current behaviour)', async () => {
      jest.mocked(runWithInheritedStdio).mockResolvedValue(2);

      await expect(stub.end([])).resolves.toBeUndefined();
      expect(runWithInheritedStdio).toHaveBeenCalledWith('yarn', declarationCommand, stubPackageFolder);
    });

    it('rejects the build when tsc cannot be started', async () => {
      jest.mocked(runWithInheritedStdio).mockRejectedValue(new Error('spawn yarn ENOENT'));

      await expect(stub.end([])).rejects.toThrow('spawn yarn ENOENT');
    });
  });
});
