import type { Plugin, PluginBuild }  from 'esbuild';
import { isAbsolute, relative }      from 'path';

/** Marks relative imports made by the package's own files external, so each source file stays its own output module. */
export function localLibImportPlugin(packageFolder: string): Plugin {
  return {
    name: 'localLibImport',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'import-statement') {
          // A sibling folder whose name starts with this folder's name is not inside it.
          if (args.path.startsWith('.') && isInsideFolder(packageFolder, args.importer)) {
            return { external: true };
          }
        }
        return undefined;
      });
    },
  };
}

function isInsideFolder(folder: string, file: string): boolean {
  const path = relative(folder, file);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}
