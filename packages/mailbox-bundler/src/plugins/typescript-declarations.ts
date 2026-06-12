import { spawnSync } from 'child_process';
import type { Plugin } from 'esbuild';

export function typescriptDeclarationsPlugin(packageFolder: string): Plugin {
  return {
    name: 'TypeScriptDeclarationsPlugin',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length > 0) return;
        spawnSync('yarn', ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'], {
          cwd: packageFolder,
          stdio: 'inherit',
        });
      });
    },
  };
}
