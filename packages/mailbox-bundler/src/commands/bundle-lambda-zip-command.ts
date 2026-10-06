import { Command, Option } from 'clipanion';
import { resolve } from 'path';

import { bundleLambdaZip } from '../lambda-zip/bundle-lambda-zip';

/**
 * CLI entry point of `mailbox-bundler lambda-zip`: turns the flags into a bundle request and runs it.
 * A bundling error or a failing `zip` rejects `execute`.
 */
export class BundleLambdaZipCommand extends Command {
  static paths = [['lambda-zip']];
  static usage = Command.Usage({
    description: 'Bundle a TS/JS Lambda entry into a zip containing a single index.js.',
    examples: [['Bundle a Lambda', 'mailbox-bundler lambda-zip --entry src/handler.ts --out /tmp/handler.zip']],
  });

  entry = Option.String('--entry', {
    required: true,
    description: 'Path to the TypeScript or JavaScript Lambda entry file, relative to the current directory or absolute. Required; given once.',
  });
  out = Option.String('--out', {
    required: true,
    description: 'Path of the zip to write, relative to the current directory or absolute. Missing folders are created and an existing zip is replaced. Required; given once.',
  });
  target = Option.String('--target', 'node24', {
    description: 'esbuild target the bundle is compiled for. Defaults to node24; given once.',
  });
  minify = Option.Boolean('--minify', true, {
    description: 'Minify the bundle. Defaults to on; pass --no-minify to turn it off.',
  });
  external = Option.String('--external', '@aws-sdk/*', {
    description: 'Comma-separated package patterns left out of the bundle. Defaults to @aws-sdk/*, which the Lambda Node.js runtime already provides; given once, with several patterns separated by commas.',
  });

  async execute(): Promise<void> {
    await bundleLambdaZip({
      entryPath: resolve(this.entry),
      outZip: resolve(this.out),
      target: this.target,
      minify: this.minify,
      externals: this.parseExternals(),
    });
  }

  private parseExternals(): string[] {
    return this.external.split(',').map(s => s.trim()).filter(Boolean);
  }
}
