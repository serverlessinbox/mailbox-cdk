import { build }             from 'esbuild';
import { zipSync }           from 'fflate';
import { mkdir, writeFile }  from 'fs/promises';
import { dirname }           from 'path';

/** Everything needed to bundle one Lambda entry file into a zip holding a single `index.js`. */
export interface LambdaZipSpec {
  readonly entryPath: string;
  readonly outZip:    string;
  readonly target:    string;
  readonly minify:    boolean;
  readonly externals: string[];
}

const entryName              = 'index.js';
const unixHostOs             = 3;
const regularFilePermissions = 0o644;
const fixedModifiedTime      = new Date('2020-01-01T00:00:00Z');

/** Turns one Lambda entry file into a zip holding a single CommonJS `index.js`. */
export class LambdaZipBundler {
  /**
   * Bundles the entry file into one CommonJS `index.js` and writes it, as the only entry of a zip
   * without directory entries, to `outZip`. Creates the folder of `outZip` and replaces an existing
   * zip. The same input always yields a byte-identical zip. Rejects when esbuild fails.
   */
  public static async bundle(spec: LambdaZipSpec): Promise<void> {
    const bundled = await LambdaZipBundler.bundleEntry(spec);
    await LambdaZipBundler.writeZip(spec.outZip, bundled);
  }

  private static async bundleEntry(spec: LambdaZipSpec): Promise<Uint8Array> {
    const result       = await build({
      entryPoints: [spec.entryPath],
      outfile:     entryName,
      platform:    'node',
      target:      spec.target,
      format:      'cjs',
      bundle:      true,
      sourcemap:   false,
      minify:      spec.minify,
      external:    spec.externals,
      write:       false,
    });
    const [outputFile] = result.outputFiles ?? [];
    if (outputFile === undefined) {
      throw new Error(`esbuild produced no output for ${spec.entryPath}`);
    }
    return outputFile.contents;
  }

  private static async writeZip(outZip: string, bundled: Uint8Array): Promise<void> {
    await mkdir(dirname(outZip), { recursive: true });
    const zipBytes = zipSync({
      [entryName]: [bundled, { 'os': unixHostOs, attrs: regularFilePermissions << 16, mtime: fixedModifiedTime }],
    });
    await writeFile(outZip, zipBytes);
  }
}
