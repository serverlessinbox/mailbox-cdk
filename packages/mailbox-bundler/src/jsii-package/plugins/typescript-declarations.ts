import type { Plugin }           from 'esbuild';

import { runWithInheritedStdio } from '../../utils/run-process';

/**
 * Emits the package's `.d.ts` files with `tsc` after a bundle that finished without errors;
 * esbuild waits for it before the build resolves. The exit code of `tsc` is deliberately not
 * checked, so a declaration error is printed but does not fail the bundle. Needs `yarn` on the
 * PATH and a `tsconfig.build.json` in the package folder.
 */
export function typescriptDeclarationsPlugin(packageFolder: string): Plugin {
  return {
    name: 'typescriptDeclarations',
    setup(build) {
      build.onEnd(async result => {
        if (result.errors.length > 0) {
          return;
        }
        await runWithInheritedStdio('yarn', ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'], packageFolder);
      });
    },
  };
}
