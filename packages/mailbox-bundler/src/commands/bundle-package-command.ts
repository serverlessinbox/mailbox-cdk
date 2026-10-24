import { Command, Option }   from 'clipanion';
import { resolve }           from 'path';

import { bundleJsiiPackage } from '../jsii-package/bundle-jsii-package';
import { readPackageJson }   from '../jsii-package/package-json';

/**
 * CLI entry point of `mailbox-bundler package`: resolves the package folder and its jsii excludes,
 * then bundles it. An unreadable or malformed package.json, or a bundling error, rejects `execute`.
 */
export class BundlePackageCommand extends Command {
  static paths = [['package']];
  static usage = Command.Usage({
    description: 'Bundle a jsii CDK construct package using esbuild',
    details:     `
      Bundles src/**/*.ts to lib/, marking jsii packages and local imports external, then emits .d.ts files via tsc --emitDeclarationOnly.

      The one required argument, \`package-folder\`, is the folder of the jsii package to bundle, relative to the current directory or absolute. It is given once.
    `,
    examples:    [['Bundle current package', 'mailbox-bundler package .']],
  });

  packageFolder = Option.String({ required: true, name: 'package-folder' });

  async execute(): Promise<void> {
    const absoluteFolder = resolve(this.packageFolder);
    const packageJson    = await readPackageJson(absoluteFolder);
    const jsiiExcludes   = packageJson.jsii?.excludeTypescript ?? [];
    await bundleJsiiPackage(absoluteFolder, jsiiExcludes);
  }
}
