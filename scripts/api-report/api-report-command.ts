import { Command, Option }     from 'clipanion';
import * as path               from 'node:path';

import { DeclarationReporter } from './declaration-reporter';

const DEFAULT_PACKAGE_SEGMENTS = ['..', '..', 'packages', 'mailbox-addon-sdk'];
const REPORT_FILE_NAME         = 'api-report.d.txt';

/**
 * Base class of the API-report subcommands. It owns the `--package` option and builds the report of the
 * package's current declarations; each subcommand decides what it does with the report and the stored baseline.
 */
export abstract class ApiReportCommand extends Command {
  packageDir = Option.String('--package', {
    description: 'Folder of the package to report on. Defaults to packages/mailbox-addon-sdk; given once.',
  });

  protected get packagePath(): string {
    return path.resolve(this.packageDir ?? path.resolve(__dirname, ...DEFAULT_PACKAGE_SEGMENTS));
  }

  protected get baselinePath(): string {
    return path.join(this.packagePath, REPORT_FILE_NAME);
  }

  protected currentReport(): string {
    return new DeclarationReporter(this.packagePath).report();
  }
}
