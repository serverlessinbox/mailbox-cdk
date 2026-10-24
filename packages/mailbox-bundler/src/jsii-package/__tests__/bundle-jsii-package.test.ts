import { build }                         from 'esbuild';
import type { BuildResult }              from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync }                    from 'fs';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { runWithInheritedStdio }         from '../../utils/run-process';
import { bundleJsiiPackage }             from '../bundle-jsii-package';

jest.mock('../../utils/run-process');
jest.mock('esbuild', () => {
  const actual = jest.requireActual<typeof import('esbuild')>('esbuild');
  return { ...actual, build: jest.fn(actual.build) };
});

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const emptyBuildResult: BuildResult = { errors: [], warnings: [], outputFiles: undefined, metafile: undefined, mangleCache: undefined };

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
  it('bundles each source file into lib/ keeping its folder, and emits declarations once', async () => {
    await bundleJsiiPackage(packageFolder, ['src/generated/**']);

    expect(existsSync(join(packageFolder, 'lib', 'a.js'))).toBe(true);
    expect(existsSync(join(packageFolder, 'lib', 'sub', 'c.js'))).toBe(true);
    expect(runWithInheritedStdio).toHaveBeenCalledTimes(1);
  });

  it('passes the source glob minus the jsii excludes to esbuild entry points', async () => {
    jest.mocked(build).mockResolvedValueOnce(emptyBuildResult);

    await bundleJsiiPackage(packageFolder, ['src/generated/**']);

    const [options] = jest.mocked(build).mock.calls[0];
    expect(options.entryPoints).toHaveLength(2);
    expect(options.entryPoints).toEqual(expect.arrayContaining([
      join(packageFolder, 'src', 'a.ts'),
      join(packageFolder, 'src', 'sub', 'c.ts'),
    ]));
  });
});
