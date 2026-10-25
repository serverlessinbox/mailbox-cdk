import type { Plugin }                    from 'esbuild';

import { runWithInheritedStdio }          from '../../utils/run-process';
import type { SharedDeclarationsInliner } from '../shared-declarations-inliner';

/**
 * Emits the package's `.d.ts` files with `tsc` after a bundle that finished without errors, then
 * has `sharedDeclarations` copy in the declarations of the package the bundle inlined; esbuild
 * waits for both before the build resolves. A non-zero exit, or a signal that stops `tsc`,
 * rejects the build; `tsc` has printed its own errors above that. Needs `yarn` on the PATH and a
 * `tsconfig.build.json` in the package folder.
 */
export function typescriptDeclarationsPlugin(packageFolder: string, sharedDeclarations: SharedDeclarationsInliner): Plugin {
  return {
    name: 'typescriptDeclarations',
    setup(build) {
      build.onEnd(async result => {
        if (result.errors.length > 0) {
          return;
        }
        const exitCode = await runWithInheritedStdio('yarn', ['tsc', '--emitDeclarationOnly', '--project', 'tsconfig.build.json'], packageFolder);
        if (exitCode !== 0) {
          const outcome = exitCode === null ? 'was terminated by a signal' : `exited with code ${exitCode}`;
          throw new Error(`yarn tsc --emitDeclarationOnly --project tsconfig.build.json ${outcome} in ${packageFolder}`);
        }
        await sharedDeclarations.inline();
      });
    },
  };
}
