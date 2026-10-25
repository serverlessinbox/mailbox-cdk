import { Command, Option }           from 'clipanion';
import { resolve }                   from 'path';

import { DeclarationClosureChecker } from '../jsii-package/declaration-closure-checker';

/**
 * CLI entry point of `mailbox-bundler check-declarations`: exits 1, printing one line per
 * violation, when the declaration closure of a built package names a package its consumers do not
 * get installed. Unreadable or malformed inputs reject `execute`.
 */
export class CheckDeclarationsCommand extends Command {
  static paths = [['check-declarations']];
  static usage = Command.Usage({
    description: 'Check that the declarations of a built package name only declared packages',
    details:     `
      Starts at the declaration file named by \`publishConfig.types\` in the package's package.json and follows every relative import. Every bare import in that closure must name a dependency or peer dependency of the package, or a Node built-in. Exits with code 1, naming the declaration file and the specifier, when one does not.

      The one required argument, \`package-folder\`, is the folder of the built package, relative to the current directory or absolute. It is given once.
    `,
    examples:    [['Check the current package', 'mailbox-bundler check-declarations .']],
  });

  packageFolder = Option.String({ required: true, name: 'package-folder' });

  async execute(): Promise<number> {
    const checker    = new DeclarationClosureChecker(resolve(this.packageFolder));
    const violations = await checker.check();

    if (violations.length === 0) {
      this.context.stdout.write('The declaration closure names only declared packages.\n');
      return 0;
    }

    for (const violation of violations) {
      this.context.stdout.write(`${violation}\n`);
    }
    const outside = await checker.countUndeclaredOutsideClosure();
    if (outside > 0) {
      this.context.stdout.write(`${outside} more declaration file(s) outside the closure also name an undeclared package.\n`);
    }
    return 1;
  }
}
