import { build }                        from 'esbuild';
import { glob }                         from 'glob';
import { join }                         from 'path';

import { jsiiIgnorePlugin }             from './plugins/jsii-ignore';
import { localLibImportPlugin }         from './plugins/local-lib-import';
import { typescriptDeclarationsPlugin } from './plugins/typescript-declarations';

const sourcesWithoutDeclarationsGlob = 'src/**/!(*.d).ts';
const testFoldersGlob                = 'src/**/__tests__/**';

/**
 * Bundles the TypeScript sources of a jsii package into its `lib/` folder, leaving jsii packages
 * and relative imports external, and emits the `.d.ts` files once the bundle succeeds.
 * `jsiiExcludes` are the package's jsii `excludeTypescript` paths, relative to the package folder.
 * Test folders (`__tests__`) are left out: they are never part of the built library.
 * Rejects when esbuild reports errors, or when the declaration emit exits non-zero.
 */
export async function bundleJsiiPackage(absoluteFolder: string, jsiiExcludes: string[]): Promise<void> {
  const ignorePatterns = [...jsiiExcludes, testFoldersGlob].map(excludePath => join(absoluteFolder, excludePath));
  const entryPoints    = await glob(join(absoluteFolder, sourcesWithoutDeclarationsGlob), { ignore: ignorePatterns });

  await build({
    plugins: [
      jsiiIgnorePlugin(absoluteFolder),
      localLibImportPlugin(absoluteFolder),
      typescriptDeclarationsPlugin(absoluteFolder),
    ],
    entryPoints,
    outdir:   join(absoluteFolder, 'lib'),
    bundle:   true,
    platform: 'node',
    logLevel: 'info',
  });
}
