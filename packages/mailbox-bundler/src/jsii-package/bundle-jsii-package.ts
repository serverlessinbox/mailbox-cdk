import { context } from 'esbuild';
import { glob } from 'glob';
import { join } from 'path';

import { jsiiIgnorePlugin } from './plugins/jsii-ignore';
import { localLibImportPlugin } from './plugins/local-lib-import';
import { typescriptDeclarationsPlugin } from './plugins/typescript-declarations';

const sourcesWithoutDeclarationsGlob = 'src/**/*!(.d).ts';

/**
 * Bundles the TypeScript sources of a jsii package into its `lib/` folder, leaving jsii packages
 * and relative imports external, and emits the `.d.ts` files once the bundle succeeds.
 * `jsiiExcludes` are the package's jsii `excludeTypescript` paths, relative to the package folder.
 * Rejects when esbuild reports errors; a failing declaration emit does not.
 */
export async function bundleJsiiPackage(absoluteFolder: string, jsiiExcludes: string[]): Promise<void> {
  const ignorePatterns = jsiiExcludes.map(p => join(absoluteFolder, p));
  const entryPoints = await glob(join(absoluteFolder, sourcesWithoutDeclarationsGlob), { ignore: ignorePatterns });

  const tsToJs = await context({
    plugins: [
      jsiiIgnorePlugin(absoluteFolder),
      localLibImportPlugin(absoluteFolder),
      typescriptDeclarationsPlugin(absoluteFolder),
    ],
    entryPoints,
    outdir: join(absoluteFolder, 'lib'),
    bundle: true,
    platform: 'node',
    logLevel: 'info',
  });

  await tsToJs.rebuild();
  await tsToJs.dispose();
}
