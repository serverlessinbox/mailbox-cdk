import { readFile }         from 'node:fs/promises';

import { errorMessage }     from '../utils/error-message';

import { ApiReportCommand } from './api-report-command';

/**
 * `api-report diff`: compares the current public-surface report with the stored baseline. `execute` returns 0
 * when they are identical and 1 when the surface differs.
 */
export class DiffCommand extends ApiReportCommand {
  static paths = [['diff']];
  static usage = ApiReportCommand.Usage({
    description: 'Compare the declarations the package build emits for its entry point with api-report.d.txt in the package. Exits 0 when identical and 1 when the public surface differs.',
    examples:    [
      ['Check the addon SDK against its baseline', 'yarn api-report diff'],
    ],
  });

  async execute(): Promise<number> {
    const baseline = await this.readBaseline();
    const current  = this.currentReport();

    if (baseline === current) {
      this.context.stdout.write('The public API matches the baseline.\n');
      return 0;
    }

    this.context.stdout.write(`The public API differs from ${this.baselinePath}. Run "yarn api-report capture" once the change is approved.\n`);
    return 1;
  }

  private async readBaseline(): Promise<string> {
    try {
      return await readFile(this.baselinePath, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read the API baseline ${this.baselinePath} (${errorMessage(error)}); run "yarn api-report capture" first`);
    }
  }
}
