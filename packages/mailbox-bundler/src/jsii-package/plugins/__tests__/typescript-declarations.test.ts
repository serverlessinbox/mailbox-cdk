import { build }                        from 'esbuild';
import type { Message }                 from 'esbuild';
import { mkdtemp, rm, writeFile }       from 'fs/promises';
import { tmpdir }                       from 'os';
import { join }                         from 'path';

import { runWithInheritedStdio }        from '../../../utils/run-process';
import { SharedDeclarationsInliner }    from '../../shared-declarations-inliner';
import { typescriptDeclarationsPlugin } from '../typescript-declarations';

import { StubPluginBuild }              from './stub-plugin-build';

jest.mock('../../../utils/run-process');
jest.mock('../../shared-declarations-inliner');

const declarationCommand = ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'];
const stubPackageFolder  = '/r/typescript-declarations';

let sharedDeclarations: SharedDeclarationsInliner;

beforeEach(() => {
  jest.clearAllMocks();
  sharedDeclarations = new SharedDeclarationsInliner(stubPackageFolder, '@scope/shared');
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
        plugins:     [typescriptDeclarationsPlugin(packageFolder, sharedDeclarations)],
      });

      expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
      expect(runWithInheritedStdio).toHaveBeenCalledWith('yarn', declarationCommand, packageFolder);
    });

    it('inlines the shared declarations once, after tsc has emitted', async () => {
      await build({
        entryPoints: [join(packageFolder, 'clean.js')],
        bundle:      true,
        write:       false,
        platform:    'node',
        plugins:     [typescriptDeclarationsPlugin(packageFolder, sharedDeclarations)],
      });

      expect(sharedDeclarations.inline).toHaveBeenCalledTimes(1);
      expect(jest.mocked(runWithInheritedStdio).mock.invocationCallOrder[0])
        .toBeLessThan(jest.mocked(sharedDeclarations.inline).mock.invocationCallOrder[0]);
    });

    it('rejects the build when the declaration emit exits non-zero', async () => {
      jest.mocked(runWithInheritedStdio).mockResolvedValue(2);

      await expect(build({
        entryPoints: [join(packageFolder, 'clean.js')],
        bundle:      true,
        write:       false,
        platform:    'node',
        plugins:     [typescriptDeclarationsPlugin(packageFolder, sharedDeclarations)],
      })).rejects.toThrow('exited with code 2');
      expect(sharedDeclarations.inline).not.toHaveBeenCalled();
    });
  });

  describe('onEnd decisions', () => {
    let stub: StubPluginBuild;

    beforeEach(() => {
      stub = new StubPluginBuild();
      stub.registerPlugin(typescriptDeclarationsPlugin(stubPackageFolder, sharedDeclarations));
    });

    it('emits nothing when the bundle has errors', async () => {
      const bundleError: Message = { id: '', pluginName: '', text: 'Unexpected token', location: null, notes: [], detail: undefined };

      await stub.end([bundleError]);

      expect(runWithInheritedStdio).not.toHaveBeenCalled();
    });

    it('rejects the build with the exit code when tsc exits non-zero', async () => {
      jest.mocked(runWithInheritedStdio).mockResolvedValue(2);

      await expect(stub.end([])).rejects.toThrow('exited with code 2');
      expect(runWithInheritedStdio).toHaveBeenCalledWith('yarn', declarationCommand, stubPackageFolder);
    });

    it('rejects the build when tsc is killed by a signal', async () => {
      jest.mocked(runWithInheritedStdio).mockResolvedValue(null);

      await expect(stub.end([])).rejects.toThrow('terminated by a signal');
    });

    it('rejects the build when tsc cannot be started', async () => {
      jest.mocked(runWithInheritedStdio).mockRejectedValue(new Error('spawn yarn ENOENT'));

      await expect(stub.end([])).rejects.toThrow('spawn yarn ENOENT');
    });
  });
});
