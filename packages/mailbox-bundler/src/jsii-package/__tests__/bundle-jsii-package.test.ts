import { build }                         from 'esbuild';
import type { BuildResult }              from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir }                        from 'os';
import { dirname, join }                 from 'path';

import { bundleJsiiPackage }             from '../bundle-jsii-package';
import { SharedDeclarationsInliner }     from '../shared-declarations-inliner';

jest.mock('esbuild', () => {
  const actual = jest.requireActual<typeof import('esbuild')>('esbuild');
  return { ...actual, build: jest.fn() };
});
jest.mock('../shared-declarations-inliner');

interface FixtureFile {
  readonly path:    string;
  readonly content: string;
}

const emptyBuildResult: BuildResult = { errors: [], warnings: [], outputFiles: undefined, metafile: undefined, mangleCache: undefined };

const sourceFixtures: FixtureFile[] = [
  { path: 'src/a.ts',           content: "export const a = 'A';" },
  { path: 'src/sub/c.ts',       content: "export const c = 'C';" },
  { path: 'src/generated/g.ts', content: "export const g = 'G';" },
  { path: 'src/types.d.ts',     content: 'export declare const t: string;' },
  { path: 'src/__tests__/a.test.ts',     content: "export const testA = 'A';" },
  { path: 'src/sub/__tests__/c.test.ts', content: "export const testC = 'C';" },
];

let packageFolder: string;

async function writeFixtures(files: FixtureFile[]): Promise<void> {
  for (const file of files) {
    const target = join(packageFolder, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

function buildOptions() {
  const [options] = jest.mocked(build).mock.calls[0];
  return options;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(build).mockResolvedValue(emptyBuildResult);
  packageFolder = await mkdtemp(join(tmpdir(), 'bundle-jsii-test-'));
  await writeFixtures(sourceFixtures);
});

afterEach(async () => {
  await rm(packageFolder, { recursive: true, force: true });
});

describe('bundleJsiiPackage', () => {
  it('leaves the jsii excludes and test folders out of the entry points', async () => {
    await bundleJsiiPackage(packageFolder, ['src/generated/**']);

    const options = buildOptions();
    expect(options.entryPoints).toHaveLength(2);
    expect(options.entryPoints).toEqual(expect.arrayContaining([
      join(packageFolder, 'src', 'a.ts'),
      join(packageFolder, 'src', 'sub', 'c.ts'),
    ]));
  });

  it('leaves declaration files out of the entry points', async () => {
    await bundleJsiiPackage(packageFolder, []);

    expect(buildOptions().entryPoints).not.toContain(join(packageFolder, 'src', 'types.d.ts'));
  });

  it('bundles into lib/ with the jsii-ignore, local-lib-import and declarations plugins, in that order', async () => {
    await bundleJsiiPackage(packageFolder, []);

    const options = buildOptions();
    expect(options.outdir).toBe(join(packageFolder, 'lib'));
    expect(options.plugins?.map(plugin => plugin.name)).toEqual(['jsiiIgnore', 'localLibImport', 'typescriptDeclarations']);
  });

  it('has the declarations plugin inline the declarations of mailbox-cdk-shared into the package', async () => {
    await bundleJsiiPackage(packageFolder, []);

    expect(SharedDeclarationsInliner).toHaveBeenCalledWith(packageFolder, '@serverlessinbox/mailbox-cdk-shared');
  });
});
