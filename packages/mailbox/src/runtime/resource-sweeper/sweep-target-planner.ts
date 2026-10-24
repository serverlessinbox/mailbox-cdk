import type { CloudFormationCustomResourceEvent }                                                       from 'aws-lambda';

import { REMOVAL_PARTS, SWEPT_ON_DELETE, isRemovalEntry }                                               from './removal';
import type { RemovalEntry, RemovalId, RemovalPartFields, RemovalPropertiesMap }                        from './removal';

/**
 * Decides what a custom-resource request needs to sweep, per registered removal and per part of it;
 * makes no AWS calls.
 * - Delete: every removal present in `ResourceProperties`, the last-known targets, whole, except removals the
 *   workflow's self-cleanup tail removes.
 * - Update: for each removal in the old properties, the OLD parts whose identity changed, or all its
 *   parts when the removal is now absent, e.g. a domain change replacing a cert or edge function. A part
 *   whose identity is unchanged is live, so it is never swept, and a removal with no part to sweep
 *   contributes nothing.
 * - Create: nothing exists yet to sweep.
 *
 * A removal's parts and their identities are those of `REMOVAL_PARTS`.
 */
export class SweepTargetPlanner {
  /** CloudFormation's own keys in the properties; never a removal id. */
  private static readonly RESERVED_PROPERTY_KEYS = new Set(['ServiceToken', 'ServiceTimeout']);

  /**
   * The removals `event` needs swept, keyed by removal id, each with the entry to sweep. An empty
   * map means nothing to sweep. CloudFormation's own keys are never part of the result.
   */
  public plan(event: CloudFormationCustomResourceEvent): RemovalPropertiesMap {
    const currentProps = this.withoutReservedKeys(event.ResourceProperties);

    // A Delete removes the resource, so every removal it last held is a target.
    if (event.RequestType === 'Delete') {
      return this.withoutSelfCleaned(currentProps);
    }
    // A Create has no earlier state, so nothing exists yet to sweep.
    if (event.RequestType === 'Create') {
      return {};
    }

    return this.supersededParts(currentProps, this.withoutReservedKeys(event.OldResourceProperties));
  }

  /** The present removals a Delete sweeps: all of them except those whose target the self-cleanup tail removes. */
  private withoutSelfCleaned(currentProps: RemovalPropertiesMap): RemovalPropertiesMap {
    const toSweep: RemovalPropertiesMap = {};
    for (const [key, value] of Object.entries(currentProps)) {
      if (!this.isRemovalId(key) || SWEPT_ON_DELETE[key]) {
        toSweep[key] = value;
      }
    }
    return toSweep;
  }

  private supersededParts(currentProps: RemovalPropertiesMap, oldProps: RemovalPropertiesMap): RemovalPropertiesMap {
    const toSweep: RemovalPropertiesMap = {};
    for (const [removalId, oldValue] of Object.entries(oldProps)) {
      // A removal this version does not know has no sweeper, so it has nothing to plan.
      if (!this.isRemovalId(removalId)) {
        continue;
      }

      const oldEntry = this.readEntry(removalId, 'OldResourceProperties', oldValue);
      const newEntry = this.readCurrentEntry(removalId, currentProps[removalId]);
      const parts    = this.partsToSweep(removalId, oldEntry, newEntry);
      // A removal with no changed part is live as a whole, so it contributes nothing.
      if (parts.length > 0) {
        toSweep[removalId] = this.entryOf(oldEntry, parts);
      }
    }
    return toSweep;
  }

  private partsToSweep(
    removalId: RemovalId,
    oldEntry: RemovalEntry,
    newEntry: RemovalEntry | undefined,
  ): readonly RemovalPartFields[] {
    // The old entry is swept whole when the update dropped the removal, because nothing will manage it any more.
    if (newEntry === undefined) {
      return REMOVAL_PARTS[removalId];
    }

    return REMOVAL_PARTS[removalId].filter((part) => oldEntry[part.identity] !== newEntry[part.identity]);
  }

  private entryOf(oldEntry: RemovalEntry, parts: readonly RemovalPartFields[]): RemovalEntry {
    const entry: RemovalEntry = {};
    for (const part of parts) {
      for (const field of part.fields) {
        entry[field] = oldEntry[field];
      }
    }
    return entry;
  }

  private readCurrentEntry(removalId: RemovalId, value: unknown): RemovalEntry | undefined {
    return value === undefined ? undefined : this.readEntry(removalId, 'ResourceProperties', value);
  }

  private readEntry(removalId: RemovalId, source: string, value: unknown): RemovalEntry {
    const errors: string[] = [];
    if (!isRemovalEntry(value, { errors })) {
      throw new Error(`Invalid ${removalId} entry in ${source}: ${errors.join('; ')}. Entry: ${JSON.stringify(value)}`);
    }

    const missing = REMOVAL_PARTS[removalId].flatMap((part) => part.fields).filter((field) => value[field] === undefined);
    if (missing.length > 0) {
      throw new Error(`Invalid ${removalId} entry in ${source}: missing ${missing.join(', ')}. Entry: ${JSON.stringify(value)}`);
    }

    return value;
  }

  private isRemovalId(key: string): key is RemovalId {
    return Object.hasOwn(REMOVAL_PARTS, key);
  }

  private withoutReservedKeys(props: RemovalPropertiesMap): RemovalPropertiesMap {
    const result: RemovalPropertiesMap = {};
    for (const [key, value] of Object.entries(props)) {
      // CloudFormation's own keys are not removals, so a sweep must never be planned for them.
      if (!SweepTargetPlanner.RESERVED_PROPERTY_KEYS.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }
}
