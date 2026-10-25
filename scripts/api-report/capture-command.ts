import { writeFile }        from 'node:fs/promises';

import { ApiReportCommand } from './api-report-command';

/**
 * `api-report capture`: writes the current public-surface report of the package as its baseline. A compile
 * or write failure rejects `execute`.
 */
export class CaptureCommand extends ApiReportCommand {
  static paths = [['capture']];
  static usage = ApiReportCommand.Usage({
    description: 'Write the declarations the package build emits for its entry point to api-report.d.txt in the package. Run it when a public API change is approved, and commit the file with the change.',
    examples:    [
      ['Capture the baseline of the addon SDK', 'yarn api-report capture'],
      ['Capture the baseline of another package', 'yarn api-report capture --package packages/some-package'],
    ],
  });

  async execute(): Promise<void> {
    await writeFile(this.baselinePath, this.currentReport());

    this.context.stdout.write(`Written: ${this.baselinePath}\n`);
  }
}
