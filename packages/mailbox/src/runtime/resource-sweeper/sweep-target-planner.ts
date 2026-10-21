import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

import type { RemovalPropertiesMap }              from './removal';

/**
 * Decides what a custom-resource request needs to sweep, per registered removal; makes no AWS calls.
 * - Delete: every removal present in `ResourceProperties`, the last-known targets.
 * - Update: for each removal in the old properties, its OLD entry when the removal is now absent or
 *   its entry changed, e.g. a domain change replacing a cert or edge function. An unchanged removal
 *   contributes nothing.
 * - Create: nothing exists yet to sweep.
 *
 * Entries are opaque: they are diffed structurally and never read field by field.
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
      return currentProps;
    }
    // A Create has no earlier state, so nothing exists yet to sweep.
    if (event.RequestType === 'Create') {
      return {};
    }

    return this.supersededRemovals(currentProps, this.withoutReservedKeys(event.OldResourceProperties));
  }

  private supersededRemovals(currentProps: RemovalPropertiesMap, oldProps: RemovalPropertiesMap): RemovalPropertiesMap {
    const toSweep: RemovalPropertiesMap = {};
    for (const [removalId, oldValue] of Object.entries(oldProps)) {
      const newValue = currentProps[removalId];
      // The old entry is swept when the update dropped or changed it, because nothing will manage it any more.
      if (newValue === undefined || !this.deepEqual(oldValue, newValue)) {
        toSweep[removalId] = oldValue;
      }
    }
    return toSweep;
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

  /** Structural equality over plain JSON-shaped values. */
  private deepEqual(a: unknown, b: unknown): boolean {
    // Identical values, equal primitives included, are equal.
    if (a === b) {
      return true;
    }
    // Past identity, only two objects can still be equal; null, primitives and mixed pairs cannot.
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      return false;
    }
    // An array and a plain object are never equal, whatever they hold.
    if (Array.isArray(a) !== Array.isArray(b)) {
      return false;
    }
    // Arrays are equal element by element, in order.
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((value, i) => this.deepEqual(value, b[i]));
    }
    const aEntries = Object.entries(a);
    const bValues  = new Map(Object.entries(b));
    return aEntries.length === bValues.size && aEntries.every(([key, value]) => this.deepEqual(value, bValues.get(key)));
  }
}
