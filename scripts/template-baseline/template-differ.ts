import { isJsonObjectNode }               from '../utils/json-value';
import type { JsonObject, JsonValue }     from '../utils/json-value';

import type { EntryChange, TemplateDiff } from './template-diff';

/**
 * Compares two CloudFormation templates entry by entry and reports which entries were added or
 * removed and, for entries in both, the property paths whose values differ. Key order inside an
 * object never counts as a difference; array order does. It decides only; it reads and writes nothing.
 */
export class TemplateDiffer {
  /** Diffs the freshly synthesized `after` against the baseline `before`. */
  diff(before: JsonObject, after: JsonObject): TemplateDiff {
    const beforeEntries = this.entriesOf(before);
    const afterEntries  = this.entriesOf(after);

    const added   = [...afterEntries.keys()].filter((entryId) => !beforeEntries.has(entryId)).sort();
    const removed = [...beforeEntries.keys()].filter((entryId) => !afterEntries.has(entryId)).sort();

    const changed: EntryChange[] = [];
    for (const [entryId, beforeEntry] of [...beforeEntries.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId))) {
      const afterEntry = afterEntries.get(entryId);
      if (afterEntry === undefined) {
        continue;
      }
      const propertyPaths = this.changedPaths(beforeEntry, afterEntry, '');
      if (propertyPaths.length > 0) {
        changed.push({ entryId, propertyPaths });
      }
    }

    return { added, removed, changed, identical: added.length === 0 && removed.length === 0 && changed.length === 0 };
  }

  private entriesOf(template: JsonObject): Map<string, JsonValue> {
    const entries = new Map<string, JsonValue>();
    for (const [section, value] of Object.entries(template)) {
      if (isJsonObjectNode(value)) {
        for (const [logicalId, entry] of Object.entries(value)) {
          entries.set(`${section}/${logicalId}`, entry);
        }
      } else {
        entries.set(section, value);
      }
    }
    return entries;
  }

  private changedPaths(before: JsonValue, after: JsonValue, path: string): string[] {
    if (isJsonObjectNode(before) && isJsonObjectNode(after)) {
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      return keys.flatMap((key) => {
        const childPath = path === '' ? key : `${path}.${key}`;
        return key in before && key in after ? this.changedPaths(before[key], after[key], childPath) : [childPath];
      });
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      const indexes = Array.from({ length: Math.max(before.length, after.length) }, (_element, index) => index);
      return indexes.flatMap((index) => {
        const childPath = `${path}[${index}]`;
        return index < before.length && index < after.length ? this.changedPaths(before[index], after[index], childPath) : [childPath];
      });
    }
    if (before === after) {
      return [];
    }
    return [path === '' ? '(value)' : path];
  }
}
