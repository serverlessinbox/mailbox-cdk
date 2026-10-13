import { DiffReportFormatter } from '../diff-report-formatter';
import type { TemplateDiff } from '../template-diff';

/**
 * Pins the text the gate prints: a failing difference and a known non-deterministic one must be
 * told apart by heading, or a reader cannot tell which differences need attention.
 */
describe('DiffReportFormatter', () => {
  const formatter = new DiffReportFormatter();

  it('prints only the stack line for an identical stack', () => {
    const diff: TemplateDiff = { added: [], removed: [], changed: [], knownNonDeterministic: [], identical: true };

    expect(formatter.format('edge', diff)).toBe('edge: identical\n');
  });

  it('lists added, removed and changed entries with their paths, and known non-deterministic ones under their own heading', () => {
    const diff: TemplateDiff = {
      added: ['Resources/New'],
      removed: ['Resources/Old'],
      changed: [{ entryId: 'Resources/Fn', propertyPaths: ['Properties.Timeout'] }],
      knownNonDeterministic: [{ entryId: 'Resources/Inv', propertyPaths: ['Properties.deploymentNonce'] }],
      identical: false,
    };

    expect(formatter.format('mailbox', diff)).toBe(
      [
        'mailbox: DIFFERENT',
        '  added (1):',
        '    Resources/New',
        '  removed (1):',
        '    Resources/Old',
        '  changed (1):',
        '    Resources/Fn',
        '      Properties.Timeout',
        '  known non-deterministic (does not fail the gate) (1):',
        '    Resources/Inv',
        '      Properties.deploymentNonce',
        '',
      ].join('\n'),
    );
  });
});
