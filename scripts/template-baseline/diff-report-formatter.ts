import type { EntryChange, TemplateDiff } from './template-diff';

/** Renders the {@link TemplateDiff} of one stack as the text `template-baseline diff` prints. */
export class DiffReportFormatter {
  /**
   * Differences that fail the gate come first; known non-deterministic ones follow under their own
   * heading, so they cannot be mistaken for real differences.
   */
  format(stackName: string, diff: TemplateDiff): string {
    const lines = [`${stackName}: ${diff.identical ? 'identical' : 'DIFFERENT'}`];

    lines.push(...this.entryList('added', diff.added));
    lines.push(...this.entryList('removed', diff.removed));
    lines.push(...this.changeList('changed', diff.changed));
    lines.push(...this.changeList('known non-deterministic (does not fail the gate)', diff.knownNonDeterministic));

    return `${lines.join('\n')}\n`;
  }

  private entryList(heading: string, entryIds: string[]): string[] {
    if (entryIds.length === 0) {
      return [];
    }
    return [`  ${heading} (${entryIds.length}):`, ...entryIds.map((entryId) => `    ${entryId}`)];
  }

  private changeList(heading: string, changes: EntryChange[]): string[] {
    if (changes.length === 0) {
      return [];
    }
    return [
      `  ${heading} (${changes.length}):`,
      ...changes.flatMap((change) => [`    ${change.entryId}`, ...change.propertyPaths.map((path) => `      ${path}`)]),
    ];
  }
}
