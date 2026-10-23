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

/** The difference between a baseline template and a fresh synth of the same stack. */
export interface TemplateDiff {
  /** Entries only the fresh synth has. */
  readonly added: string[];
  /** Entries only the baseline has. */
  readonly removed: string[];
  /** Entries in both whose properties differ. */
  readonly changed: EntryChange[];
  /** True when nothing was added, removed or changed. */
  readonly identical: boolean;
}
