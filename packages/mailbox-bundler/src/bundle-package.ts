import { Command, Option } from 'clipanion';
import { context } from 'esbuild';
import { readFileSync } from 'fs';
import { sync as globSync } from 'glob';
import { join } from 'path';

import { jsiiIgnorePlugin } from './plugins/jsii-ignore';
import { localLibImportPlugin } from './plugins/local-lib-import';
import { typescriptDeclarationsPlugin } from './plugins/typescript-declarations';

export class BundlePackageCommand extends Command {
  static paths = [['package']];
  static usage = Command.Usage({
    description: 'Bundle a jsii CDK construct package using esbuild',
    details: 'Bundles src/**/*.ts to lib/, marking jsii packages and local imports external, then emits .d.ts files via tsc --emitDeclarationOnly.',
    examples: [['Bundle current package', 'mailbox-bundler package .']],
  });

  packageFolder = Option.String({ required: true });

  async execute(): Promise<void> {
    const absoluteFolder = join(process.cwd(), this.packageFolder);

    const pkgJson = JSON.parse(readFileSync(join(absoluteFolder, 'package.json'), 'utf-8')) as {
      jsii?: { excludeTypescript?: string[] };
    };
    const jsiiExcludes: string[] = pkgJson.jsii?.excludeTypescript ?? [];
    const ignorePatterns = jsiiExcludes.map(p => join(absoluteFolder, p));

    const tsToJs = await context({
      plugins: [
        jsiiIgnorePlugin(absoluteFolder),
        localLibImportPlugin(absoluteFolder),
        typescriptDeclarationsPlugin(absoluteFolder),
      ],
      entryPoints: globSync(join(absoluteFolder, 'src/**/*!(.d).ts'), { ignore: ignorePatterns }),
      outdir: join(absoluteFolder, 'lib'),
      bundle: true,
      platform: 'node',
      logLevel: 'info',
    });

    await tsToJs.rebuild();
    await tsToJs.dispose();
  }
}
