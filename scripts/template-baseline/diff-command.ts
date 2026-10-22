import { BaselineCommand }                    from './baseline-command';
import { DiffReportFormatter }                from './diff-report-formatter';
import { KNOWN_NON_DETERMINISTIC_PROPERTIES } from './known-non-deterministic-properties';
import { TemplateDiffer }                     from './template-differ';

/**
 * `template-baseline diff`: synthesizes every stack again and compares each template with the
 * captured baseline. `execute` returns 0 only when every stack is identical, so the command can
 * gate a refactor.
 */
export class DiffCommand extends BaselineCommand {
  static paths = [['diff']];
  static usage = BaselineCommand.Usage({
    description: 'Synthesize every stack the product deploys and report, per stack, the logical IDs added, removed, and changed (with the property paths that changed) against the baseline captured under the label. Exits 0 when all stacks are identical, 1 otherwise. Properties known to vary between synths of identical code are listed apart and do not fail the run.',
    examples:    [
      ['Compare against the default baseline', 'yarn template-baseline diff'],
      ['Compare against a named baseline', 'yarn template-baseline diff --label before-resource-split'],
    ],
  });

  async execute(): Promise<number> {
    const store     = this.createStore();
    const differ    = new TemplateDiffer(KNOWN_NON_DETERMINISTIC_PROPERTIES);
    const formatter = new DiffReportFormatter();

    let allIdentical = true;
    for (const { stackName, template } of this.createSynthesizer().synthesize()) {
      const baseline = await store.readStackTemplate(this.label, stackName);
      const diff     = differ.diff(baseline, template);
      this.context.stdout.write(formatter.format(stackName, diff));
      allIdentical = allIdentical && diff.identical;
    }

    return allIdentical ? 0 : 1;
  }
}
