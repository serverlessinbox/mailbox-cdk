/**
 * One template entry that exists in both templates but differs. An entry is a resource,
 * parameter, condition, output or mapping, identified as `<Section>/<LogicalId>`; a template
 * member that is not a collection of entries (the description) is identified by its own name.
 */
export interface EntryChange {
  readonly entryId: string;
  /** Dotted paths (`Properties.Environment.Variables.NAME`, `Properties.Tags[2]`) of the values that differ; `(value)` when the entry is itself a single value. */
  readonly propertyPaths: string[];
}

/**
 * A property that differs between two synths of identical code, because the source computes it from
 * something that is not stable. A difference there is reported apart from the real differences.
 */
export interface NonDeterministicProperty {
  /** The CloudFormation resource type the property belongs to, for example `Custom::ContentDeployer`. */
  readonly resourceType: string;
  /** Path of the property from the resource root, for example `Properties.deploymentNonce`; it also covers everything beneath it. */
  readonly propertyPath: string;
  /** Why the value is not stable, in terms of the source that computes it. */
  readonly reason: string;
}

/** The difference between a baseline template and a fresh synth of the same stack. */
export interface TemplateDiff {
  /** Entries only the fresh synth has. */
  readonly added: string[];
  /** Entries only the baseline has. */
  readonly removed: string[];
  /** Entries in both whose properties differ in a way that is not known to be non-deterministic. */
  readonly changed: EntryChange[];
  /** Differences confined to properties listed as {@link NonDeterministicProperty}; they do not fail a gate. */
  readonly knownNonDeterministic: EntryChange[];
  /** True when nothing was added, removed or changed; known non-deterministic differences do not count. */
  readonly identical: boolean;
}
