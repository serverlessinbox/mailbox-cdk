import { BaselineCommand } from './baseline-command';

/**
 * `template-baseline capture`: synthesizes the templates under fixed props, an explicit environment
 * and a frozen clock, and stores each one under the label. A synth or write failure rejects `execute`.
 */
export class CaptureCommand extends BaselineCommand {
  static paths = [['capture']];
  static usage = BaselineCommand.Usage({
    description: 'Synthesize the templates under fixed inputs and write each one as formatted JSON to .template-baseline/<label>/<stack>.template.json. Run it before a refactor, then run "diff" after it.',
    examples:    [
      ['Capture the baseline before a refactor', 'yarn template-baseline capture'],
      ['Capture under a name', 'yarn template-baseline capture --label before-resource-split'],
    ],
  });

  async execute(): Promise<void> {
    const templates = this.createSynthesizer().synthesize();

    const files = await this.createStore().write(this.label, templates);

    for (const file of files) {
      this.context.stdout.write(`Written: ${file}\n`);
    }
  }
}
