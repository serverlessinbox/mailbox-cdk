import type { Plugin, PluginBuild } from 'esbuild';

export function localLibImportPlugin(packageFolder: string): Plugin {
  return {
    name: 'localLibImport',
    setup(buildInstance: PluginBuild) {
      buildInstance.onResolve({ filter: /.*/ }, async args => {
        if (args.kind === 'import-statement') {
          if (args.path.startsWith('.') && args.importer.startsWith(packageFolder)) {
            return { external: true };
          }
        }
        return undefined;
      });
    },
  };
}
