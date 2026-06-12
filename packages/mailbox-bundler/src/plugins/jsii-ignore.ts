import { createRequire } from 'module';
import { dirname } from 'path';
import type { Plugin, PluginBuild } from 'esbuild';

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

function isJsiiPackage(packageRequire: NodeRequire, packageName: string): boolean {
  if (packageName.startsWith('.')) {
    return false;
  }
  try {
    packageRequire.resolve(`${packageName}/.jsii`);
    return true;
  } catch (_error) {
    if (packageName.includes('/')) {
      const parentPackageName = dirname(packageName);
      if (parentPackageName !== packageName) {
        return isJsiiPackage(packageRequire, parentPackageName);
      }
    }
    return false;
  }
}
