import { isJsonObjectNode }                                         from '../utils/json-value';
import type { JsonObject, JsonValue }                               from '../utils/json-value';

import type { EntryChange, NonDeterministicProperty, TemplateDiff } from './template-diff';

const RESOURCES_SECTION_PREFIX = 'Resources/';

/**
 * Compares two CloudFormation templates entry by entry and reports which entries were added or
 * removed and, for entries in both, the property paths whose values differ. Key order inside an
 * object never counts as a difference; array order does. It decides only; it reads and writes nothing.
 */
export class TemplateDiffer {
  constructor(private readonly knownNonDeterministic: readonly NonDeterministicProperty[]) {}

  /** Diffs the freshly synthesized `after` against the baseline `before`. */
  diff(before: JsonObject, after: JsonObject): TemplateDiff {
    const beforeEntries = this.entriesOf(before);
    const afterEntries  = this.entriesOf(after);

    const added   = [...afterEntries.keys()].filter((entryId) => !beforeEntries.has(entryId)).sort();
    const removed = [...beforeEntries.keys()].filter((entryId) => !afterEntries.has(entryId)).sort();

    const changed: EntryChange[]               = [];
    const knownNonDeterministic: EntryChange[] = [];
    for (const [entryId, beforeEntry] of [...beforeEntries.entries()].sort(([leftId], [rightId]) => leftId.localeCompare(rightId))) {
      const afterEntry = afterEntries.get(entryId);
      if (afterEntry === undefined) {
        continue;
      }
      const paths        = this.changedPaths(beforeEntry, afterEntry, '');
      const resourceType = this.resourceTypeOf(entryId, afterEntry);
      const knownPaths   = paths.filter((path) => this.isKnownNonDeterministic(resourceType, path));
      const realPaths    = paths.filter((path) => !knownPaths.includes(path));
      if (realPaths.length > 0) {
        changed.push({ entryId, propertyPaths: realPaths });
      }
      if (knownPaths.length > 0) {
        knownNonDeterministic.push({ entryId, propertyPaths: knownPaths });
      }
    }

    return { added, removed, changed, knownNonDeterministic, identical: added.length === 0 && removed.length === 0 && changed.length === 0 };
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

  private resourceTypeOf(entryId: string, entry: JsonValue): string | undefined {
    if (!entryId.startsWith(RESOURCES_SECTION_PREFIX) || !isJsonObjectNode(entry)) {
      return undefined;
    }
    const type = entry.Type;
    return typeof type === 'string' ? type : undefined;
  }

  /** Only resources can carry a known non-deterministic property; any other entry always counts. */
  private isKnownNonDeterministic(resourceType: string | undefined, path: string): boolean {
    return this.knownNonDeterministic.some(
      (known) =>
        known.resourceType === resourceType &&
        (path === known.propertyPath || path.startsWith(`${known.propertyPath}.`) || path.startsWith(`${known.propertyPath}[`)),
    );
  }}
