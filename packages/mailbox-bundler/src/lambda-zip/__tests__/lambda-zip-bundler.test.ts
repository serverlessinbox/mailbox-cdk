import * as esbuildModule                                    from 'esbuild';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile }  from 'fs/promises';
import { existsSync }                                        from 'fs';
import * as osModule                                         from 'os';
import { dirname, join }                                     from 'path';

import { runWithInheritedStdio }                             from '../../utils/run-process';
import { LambdaZipBundler, LambdaZipSpec }                   from '../lambda-zip-bundler';

jest.mock('../../utils/run-process');
jest.mock('esbuild', () => {
  const actual = jest.requireActual<typeof esbuildModule>('esbuild');
  return { ...actual, build: jest.fn(actual.build) };
});
jest.mock('os', () => {
  const actual = jest.requireActual<typeof osModule>('os');
  return { ...actual, tmpdir: jest.fn(actual.tmpdir) };
});

const realBuild  = jest.requireActual<typeof esbuildModule>('esbuild').build;
const realTmpdir = jest.requireActual<typeof osModule>('os').tmpdir;

interface ZipRun {
  readonly command:       string;
  readonly args:          string[];
  readonly outZipExisted: boolean;
  readonly bundledJs:     string;
}

const handlerSource = `
import { S3Client } from '@aws-sdk/client-s3';
import { marker } from './helper';

export const handler = () => [S3Client, marker];
`;

const helperSource = `
// helper comment kept by an unminified bundle
export const marker = 'BUNDLED_HELPER_MARKER';
`;

let workDir: string;
let tempRoot: string;
let zipRuns: ZipRun[];

/** Fakes the `zip` binary: records its arguments and what it saw, then returns the exit code. */
function zipExitsWith(exitCode: number | null): void {
  jest.mocked(runWithInheritedStdio).mockImplementation(async (command, args) => {
    const [, outZip, outJs] = args;
    zipRuns.push({
      command,
      args,
      outZipExisted: existsSync(outZip),
      bundledJs:     await readFile(outJs, 'utf-8'),
    });
    return exitCode;
  });
}

/** Stands in for esbuild by writing a placeholder index.js, so the zip fake has a file to read. */
async function stubBuild(options: esbuildModule.BuildOptions): Promise<esbuildModule.BuildResult> {
  if (options.outfile === undefined) {
    throw new Error('stubBuild needs an outfile');
  }
  await writeFile(options.outfile, 'module.exports = {};\n');
  return { errors: [], warnings: [], outputFiles: undefined, metafile: undefined, mangleCache: undefined };
}

function bundleSpec(overrides: Partial<LambdaZipSpec> = {}): LambdaZipSpec {
  return {
    entryPath: join(workDir, 'handler.ts'),
    outZip:    join(workDir, 'out', 'handler.zip'),
    target:    'node24',
    minify:    false,
    externals: ['@aws-sdk/*'],
    ...overrides,
  };
}

async function bundleAndCaptureJs(spec: LambdaZipSpec): Promise<string> {
  await LambdaZipBundler.bundle(spec);
  const lastRun = zipRuns.at(-1);
  if (lastRun === undefined) {
    throw new Error('zip was not called');
  }
  return lastRun.bundledJs;
}

async function leftoverTempDirs(): Promise<string[]> {
  return readdir(tempRoot);
}

beforeEach(async () => {
  jest.clearAllMocks();
  workDir  = await mkdtemp(join(realTmpdir(), 'lambda-zip-test-'));
  tempRoot = await mkdtemp(join(workDir, 'tmp-'));
  jest.mocked(osModule.tmpdir).mockReturnValue(tempRoot);
  jest.mocked(esbuildModule.build).mockImplementation(stubBuild);
  zipRuns = [];
  await writeFile(join(workDir, 'handler.ts'), handlerSource);
  await writeFile(join(workDir, 'helper.ts'), helperSource);
  zipExitsWith(0);
});

afterEach(async () => {
  jest.mocked(osModule.tmpdir).mockImplementation(realTmpdir);
  await rm(workDir, { recursive: true, force: true });
});

describe('LambdaZipBundler.bundle', () => {
  it('creates the output folder and zips the single bundled index.js', async () => {
    const outZip = join(workDir, 'out', 'nested', 'handler.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    expect(existsSync(dirname(outZip))).toBe(true);
    expect(zipRuns).toHaveLength(1);
    expect(zipRuns[0]?.command).toBe('zip');
    expect(zipRuns[0]?.args).toEqual(['-j', outZip, expect.stringMatching(/index\.js$/)]);
  });

  it('removes an existing zip before the zip command runs', async () => {
    const outZip = join(workDir, 'out', 'handler.zip');
    await mkdir(dirname(outZip), { recursive: true });
    await writeFile(outZip, 'previous archive');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    expect(zipRuns[0]?.outZipExisted).toBe(false);
  });

  it('bundles CommonJS and keeps the external packages as require calls', async () => {
    jest.mocked(esbuildModule.build).mockImplementationOnce(realBuild);

    const bundledJs = await bundleAndCaptureJs(bundleSpec());

    expect(bundledJs).toContain('module.exports');
    expect(bundledJs).toContain('require("@aws-sdk/client-s3")');
    expect(bundledJs).toContain('BUNDLED_HELPER_MARKER');
  });

  it.each([true, false])('passes the minify flag to esbuild (minify: %s)', async (minify) => {
    jest.mocked(runWithInheritedStdio).mockResolvedValue(0);

    await LambdaZipBundler.bundle(bundleSpec({ minify }));

    expect(esbuildModule.build).toHaveBeenCalledWith(expect.objectContaining({ minify }));
  });

  it('rejects with the exit code and the zip path when zip exits non-zero', async () => {
    zipExitsWith(3);
    const spec = bundleSpec();

    await expect(LambdaZipBundler.bundle(spec)).rejects.toThrow(`zip exited with code 3 while writing ${spec.outZip}`);
  });

  it('rejects with the null code when zip is killed by a signal (BND-8, current message)', async () => {
    zipExitsWith(null);
    const spec = bundleSpec();

    await expect(LambdaZipBundler.bundle(spec)).rejects.toThrow(`zip exited with code null while writing ${spec.outZip}`);
  });

  it('rejects without running zip when esbuild fails', async () => {
    jest.mocked(esbuildModule.build).mockImplementationOnce(realBuild);
    const spec = bundleSpec({ entryPath: join(workDir, 'missing.ts') });

    await expect(LambdaZipBundler.bundle(spec)).rejects.toThrow();
    expect(runWithInheritedStdio).not.toHaveBeenCalled();
  });

  it('removes its temp folder after a successful bundle', async () => {
    await LambdaZipBundler.bundle(bundleSpec());

    expect(zipRuns[0]?.args[2]).toEqual(expect.stringContaining(tempRoot));
    expect(await leftoverTempDirs()).toEqual([]);
  });

  it('removes its temp folder when zip fails', async () => {
    zipExitsWith(3);

    await LambdaZipBundler.bundle(bundleSpec()).catch(() => undefined);

    expect(await leftoverTempDirs()).toEqual([]);
  });

  it('removes its temp folder when esbuild fails', async () => {
    jest.mocked(esbuildModule.build).mockImplementationOnce(realBuild);

    await LambdaZipBundler.bundle(bundleSpec({ entryPath: join(workDir, 'missing.ts') })).catch(() => undefined);

    expect(await leftoverTempDirs()).toEqual([]);
  });
});
