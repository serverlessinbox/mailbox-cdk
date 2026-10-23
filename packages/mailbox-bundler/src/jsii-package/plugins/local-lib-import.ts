import type { Plugin, PluginBuild } from 'esbuild';

/** Marks relative imports made by the package's own files external, so each source file stays its own output module. */
export function localLibImportPlugin(packageFolder: string): Plugin {
  return {
    name: 'localLibImport',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, args => {
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
