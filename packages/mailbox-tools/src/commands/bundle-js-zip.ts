import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as esbuild from 'esbuild';
import { Command, Option } from 'clipanion';
import { run } from '../utils/common';

function ensureParentDirExists(filePath: string): void {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

export class BundleJsZipCommand extends Command {
  static override paths = [['bundle', 'js-zip']];

  static override usage = Command.Usage({
    description: 'Bundle a JS/TS entrypoint into a zip containing a single index.js at the root.',
    examples: [
      ['Bundle a Lambda-like zip', '$0 bundle js-zip --entry src/handler.ts --out dist/handler.zip'],
      ['Bundle with explicit target', '$0 bundle js-zip --entry src/handler.ts --out dist/handler.zip --target node18'],
    ],
  });

  entry = Option.String('--entry', {
    required: true,
    description: 'Entry file (.ts/.js). Can be absolute or relative to CWD.',
  });

  out = Option.String('--out', {
    required: true,
    description: 'Output zip path.',
  });

  target = Option.String('--target', 'node18', {
    description: 'esbuild target (e.g. node18, node20).',
  });

  minify = Option.Boolean('--minify', true, {
    description: 'Minify output bundle.',
  });

  external = Option.String('--external', 'aws-sdk', {
    description: 'Comma-separated esbuild externals. Default: aws-sdk',
  });

  async execute(): Promise<number> {
    const entryPath = path.isAbsolute(this.entry) ? this.entry : path.join(process.cwd(), this.entry);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      throw new Error(`Entry file not found: ${entryPath}`);
    }

    const outZip = path.isAbsolute(this.out) ? this.out : path.join(process.cwd(), this.out);
    ensureParentDirExists(outZip);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-tools-bundle-'));
    try {
      const outJs = path.join(tmpDir, 'index.js');

      const externals = this.external
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      await esbuild.build({
        entryPoints: [entryPath],
        outfile: outJs,
        platform: 'node',
        target: this.target,
        format: 'cjs',
        bundle: true,
        sourcemap: false,
        minify: this.minify,
        external: externals,
      });

      // Zip contains a single file `index.js` at the archive root.
      // `-j` strips directory paths, ensuring the root layout.
      run('zip', ['-j', outZip, outJs]);

      return 0;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
