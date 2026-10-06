import { createRequire } from 'module';
import { dirname } from 'path';
import type { Plugin, PluginBuild } from 'esbuild';

/**
 * Marks every `import` of a jsii package external, so the bundle keeps referring to the one
 * shared copy of its types. Packages are looked up the way the package being bundled would
 * see them, starting from its own entry file.
 */
export function jsiiIgnorePlugin(packageFolder: string): Plugin {
  const packageRequire = createRequire(require.resolve(packageFolder));
  return {
    name: 'jsiiIgnore',
    setup(buildInstance: PluginBuild) {
      buildInstance.onResolve({ filter: /.*/ }, async args => {
        if (args.kind === 'import-statement') {
          if (isJsiiPackage(packageRequire, args.path)) {
            return { external: true };
          }
        }
        return undefined;
      });
    },
  };
}

/**
 * A package is a jsii package when it ships the `.jsii` assembly file that the jsii compiler
 * writes at the root of every package it builds. A deep import such as `pkg/sub/file` is judged
 * by the nearest ancestor path that resolves to a package root.
 */
function isJsiiPackage(packageRequire: NodeRequire, packageName: string): boolean {
  if (packageName.startsWith('.')) {
    return false;
  }
  try {
    packageRequire.resolve(`${packageName}/.jsii`);
    return true;
  } catch {
    if (packageName.includes('/')) {
      const parentPackageName = dirname(packageName);
      if (parentPackageName !== packageName) {
        return isJsiiPackage(packageRequire, parentPackageName);
      }
    }
    return false;
  }
}
