import { mkdir, mkdtemp, readdir, readFile, rm, writeFile }  from 'fs/promises';
import { existsSync }                                        from 'fs';
import { tmpdir }                                            from 'os';
import { dirname, join }                                     from 'path';

import { runWithInheritedStdio }                             from '../../utils/run-process';
import { LambdaZipBundler, LambdaZipSpec }                   from '../lambda-zip-bundler';

jest.mock('../../utils/run-process');

interface ZipRun {
  readonly command:       string;
  readonly args:          string[];
  readonly outZipExisted: boolean;
  readonly bundledJs:     string;
}

const tempDirPrefix = 'mailbox-bundler-lambda-';

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

async function bundlerTempDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter(name => name.startsWith(tempDirPrefix));
}

beforeEach(async () => {
  jest.clearAllMocks();
  workDir = await mkdtemp(join(tmpdir(), 'lambda-zip-test-'));
  zipRuns = [];
  await writeFile(join(workDir, 'handler.ts'), handlerSource);
  await writeFile(join(workDir, 'helper.ts'), helperSource);
  zipExitsWith(0);
});

afterEach(async () => {
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
    const bundledJs = await bundleAndCaptureJs(bundleSpec());

    expect(bundledJs).toContain('module.exports');
    expect(bundledJs).toContain('require("@aws-sdk/client-s3")');
    expect(bundledJs).toContain('BUNDLED_HELPER_MARKER');
  });

  it('produces a smaller bundle when minification is on', async () => {
    const plainJs    = await bundleAndCaptureJs(bundleSpec({ minify: false }));
    const minifiedJs = await bundleAndCaptureJs(bundleSpec({ minify: true }));

    expect(minifiedJs.length).toBeLessThan(plainJs.length);
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
    const spec = bundleSpec({ entryPath: join(workDir, 'missing.ts') });

    await expect(LambdaZipBundler.bundle(spec)).rejects.toThrow();
    expect(runWithInheritedStdio).not.toHaveBeenCalled();
  });

  it('removes its temp folder after a successful bundle', async () => {
    const before = await bundlerTempDirs();

    await LambdaZipBundler.bundle(bundleSpec());

    expect(await bundlerTempDirs()).toEqual(before);
  });

  it('removes its temp folder when zip fails', async () => {
    const before = await bundlerTempDirs();
    zipExitsWith(3);

    await LambdaZipBundler.bundle(bundleSpec()).catch(() => undefined);

    expect(await bundlerTempDirs()).toEqual(before);
  });

  it('removes its temp folder when esbuild fails', async () => {
    const before = await bundlerTempDirs();

    await LambdaZipBundler.bundle(bundleSpec({ entryPath: join(workDir, 'missing.ts') })).catch(() => undefined);

    expect(await bundlerTempDirs()).toEqual(before);
  });
});
