import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync }                    from 'fs';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { runWithInheritedStdio }         from '../../utils/run-process';
import { bundleJsiiPackage }             from '../bundle-jsii-package';

jest.mock('../../utils/run-process');

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const sourceFixtures: FixtureFile[] = [
  { path: 'index.js',           content: 'module.exports = {};' },
  { path: 'src/a.ts',           content: "export const a = 'A';" },
  { path: 'src/sub/c.ts',       content: "export const c = 'C';" },
  { path: 'src/generated/g.ts', content: "export const g = 'G';" },
];

let packageFolder: string;

async function writeFixtures(files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(packageFolder, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(runWithInheritedStdio).mockResolvedValue(0);
  packageFolder = await mkdtemp(join(tmpdir(), 'bundle-jsii-test-'));
  await writeFixtures(sourceFixtures);
});

afterEach(async () => {
  await rm(packageFolder, { recursive: true, force: true });
});

describe('bundleJsiiPackage', () => {
  it('bundles each source file into lib/, keeping its folder', async () => {
    await bundleJsiiPackage(packageFolder, []);

    expect(existsSync(join(packageFolder, 'lib', 'a.js'))).toBe(true);
    expect(existsSync(join(packageFolder, 'lib', 'sub', 'c.js'))).toBe(true);
  });

  it('leaves out the paths jsii excludes', async () => {
    await bundleJsiiPackage(packageFolder, ['src/generated/**']);

    expect(existsSync(join(packageFolder, 'lib', 'generated', 'g.js'))).toBe(false);
    expect(existsSync(join(packageFolder, 'lib', 'a.js'))).toBe(true);
  });

  it('emits the declarations once after a clean bundle', async () => {
    await bundleJsiiPackage(packageFolder, []);

    expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
  });

  it('rejects on a bundling error and emits no declarations', async () => {
    await writeFixtures([{ path: 'src/broken.ts', content: 'export const = ;' }]);

    await expect(bundleJsiiPackage(packageFolder, [])).rejects.toThrow();
    expect(runWithInheritedStdio).not.toHaveBeenCalled();
  });
});
