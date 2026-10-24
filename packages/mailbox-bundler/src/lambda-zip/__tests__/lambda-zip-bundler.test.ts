import * as esbuildModule                          from 'esbuild';
import { unzipSync }                               from 'fflate';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync }                              from 'fs';
import * as osModule                               from 'os';
import { dirname, join }                           from 'path';

import { LambdaZipBundler, LambdaZipSpec }         from '../lambda-zip-bundler';

jest.mock('esbuild', () => {
  const actual = jest.requireActual<typeof esbuildModule>('esbuild');
  return { ...actual, build: jest.fn(actual.build) };
});

const realTmpdir = jest.requireActual<typeof osModule>('os').tmpdir;

const handlerSource = `
import { S3Client } from '@aws-sdk/client-s3';
import { marker } from './helper';

export const handler = () => [S3Client, marker];
`;

const helperSource = `
// helper comment kept by an unminified bundle
export const marker = 'BUNDLED_HELPER_MARKER';
`;

const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

let workDir: string;

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

async function readZip(outZip: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(outZip));
}

/** Reads the host OS byte and the external attributes of the single central directory header. */
function centralHeaderOf(zip: Uint8Array): DataView {
  const offset = Buffer.from(zip).indexOf(centralDirectorySignature);
  if (offset < 0) {
    throw new Error('zip has no central directory header');
  }
  return new DataView(zip.buffer, zip.byteOffset + offset, 46);
}

beforeEach(async () => {
  jest.clearAllMocks();
  workDir = await mkdtemp(join(realTmpdir(), 'lambda-zip-test-'));
  await writeFile(join(workDir, 'handler.ts'), handlerSource);
  await writeFile(join(workDir, 'helper.ts'), helperSource);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('LambdaZipBundler.bundle', () => {
  it('creates the output folder and writes the zip there', async () => {
    const outZip = join(workDir, 'out', 'nested', 'handler.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    expect(existsSync(dirname(outZip))).toBe(true);
    expect(existsSync(outZip)).toBe(true);
  });

  it('replaces an existing zip with the new archive', async () => {
    const outZip = join(workDir, 'out', 'handler.zip');
    await mkdir(dirname(outZip), { recursive: true });
    await writeFile(outZip, 'previous archive');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    expect(Object.keys(unzipSync(await readZip(outZip)))).toEqual(['index.js']);
  });

  it('bundles CommonJS and keeps the external packages as require calls', async () => {
    const outZip = join(workDir, 'out', 'handler.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    const bundledJs = Buffer.from(unzipSync(await readZip(outZip))['index.js'] ?? []).toString('utf-8');
    expect(bundledJs).toContain('module.exports');
    expect(bundledJs).toContain('require("@aws-sdk/client-s3")');
    expect(bundledJs).toContain('BUNDLED_HELPER_MARKER');
  });

  it.each([true, false])('passes the minify flag to esbuild (minify: %s)', async (minify) => {
    await LambdaZipBundler.bundle(bundleSpec({ minify }));

    expect(esbuildModule.build).toHaveBeenCalledWith(expect.objectContaining({ minify, write: false }));
  });

  it('rejects and writes no zip when esbuild fails', async () => {
    const spec = bundleSpec({ entryPath: join(workDir, 'missing.ts') });

    await expect(LambdaZipBundler.bundle(spec)).rejects.toThrow();
    expect(existsSync(spec.outZip)).toBe(false);
  });

  it('writes a zip whose only entry is index.js, with no directory entries', async () => {
    const outZip = join(workDir, 'out', 'handler.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    expect(Object.keys(unzipSync(await readZip(outZip)))).toEqual(['index.js']);
  });

  it('marks the entry as a Unix file with 0644 permissions in the central directory', async () => {
    const outZip = join(workDir, 'out', 'handler.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip }));

    const header = centralHeaderOf(await readZip(outZip));
    expect(header.getUint8(5)).toBe(3);
    expect((header.getUint32(38, true) >>> 16) & 0o777).toBe(0o644);
  });

  it('produces a byte-identical zip for the same input', async () => {
    const firstZip  = join(workDir, 'out', 'first.zip');
    const secondZip = join(workDir, 'out', 'second.zip');

    await LambdaZipBundler.bundle(bundleSpec({ outZip: firstZip }));
    await LambdaZipBundler.bundle(bundleSpec({ outZip: secondZip }));

    expect(await readZip(secondZip)).toEqual(await readZip(firstZip));
  });
});
