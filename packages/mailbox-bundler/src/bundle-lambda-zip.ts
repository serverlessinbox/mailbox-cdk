import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as esbuild from 'esbuild';
import { Command, Option } from 'clipanion';
import { execFileSync } from 'node:child_process';

export class BundleLambdaZipCommand extends Command {
  static paths = [['lambda-zip']];
  static usage = Command.Usage({
    description: 'Bundle a TS/JS Lambda entry into a zip containing a single index.js.',
    examples: [['Bundle a Lambda', 'mailbox-bundler lambda-zip --entry src/handler.ts --out /tmp/handler.zip']],
  });

  entry = Option.String('--entry', { required: true });
  out = Option.String('--out', { required: true });
  target = Option.String('--target', 'node18');
  minify = Option.Boolean('--minify', true);
  external = Option.String('--external', 'aws-sdk');

  async execute(): Promise<void> {
    const entryPath = path.resolve(this.entry);
    const outZip = path.resolve(this.out);
    fs.mkdirSync(path.dirname(outZip), { recursive: true });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-bundler-lambda-'));
    try {
      const outJs = path.join(tmpDir, 'index.js');
      const externals = this.external.split(',').map(s => s.trim()).filter(Boolean);
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
      fs.rmSync(outZip, { force: true });
      execFileSync('zip', ['-j', outZip, outJs], { stdio: 'inherit' });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
