import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { runWithInheritedStdio } from '../utils/run-process';

/** Everything needed to bundle one Lambda entry file into a zip holding a single `index.js`. */
export interface LambdaZipSpec {
  readonly entryPath: string;
  readonly outZip: string;
  readonly target: string;
  readonly minify: boolean;
  readonly externals: string[];
}

/**
 * Bundles the entry file into one CommonJS `index.js` and zips it, without directory entries,
 * into `outZip`, creating its folder and replacing an existing zip. Zipping uses the system
 * `zip` binary, which must be on the PATH. Rejects when esbuild fails or `zip` exits non-zero.
 */
export async function bundleLambdaZip(spec: LambdaZipSpec): Promise<void> {
  await mkdir(dirname(spec.outZip), { recursive: true });

  const tmpDir = await mkdtemp(join(tmpdir(), 'mailbox-bundler-lambda-'));
  try {
    const outJs = join(tmpDir, 'index.js');
    await build({
      entryPoints: [spec.entryPath],
      outfile: outJs,
      platform: 'node',
      target: spec.target,
      format: 'cjs',
      bundle: true,
      sourcemap: false,
      minify: spec.minify,
      external: spec.externals,
    });
    await rm(spec.outZip, { force: true });
    const exitCode = await runWithInheritedStdio('zip', ['-j', spec.outZip, outJs]);
    if (exitCode !== 0) {
      throw new Error(`zip exited with code ${exitCode} while writing ${spec.outZip}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
