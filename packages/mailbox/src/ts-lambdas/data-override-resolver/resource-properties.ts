import * as t from 'typanion';

/** The data tables whose ARN the resolver decides, by the role each plays in the mailbox. */
export type TableRole = 'configTable' | 'itemTable' | 'changelogTable' | 'auditLogTable' | 'mailFeedbackTable';

/**
 * Schema of the custom-resource properties the construct hands to the resolver Lambda: for each data
 * table role, the stack's own table ARN and the operator-overridable parameter's current value.
 * CloudFormation adds keys of its own (such as `ServiceToken`), so unlisted keys are accepted.
 */
export const isResourceProperties = t.isPartial({
  configTableIncomingArn: t.isString(),
  configTableOverrideArn: t.isString(),
  itemTableIncomingArn: t.isString(),
  itemTableOverrideArn: t.isString(),
  changelogTableIncomingArn: t.isString(),
  changelogTableOverrideArn: t.isString(),
  auditLogTableIncomingArn: t.isString(),
  auditLogTableOverrideArn: t.isString(),
  mailFeedbackTableIncomingArn: t.isString(),
  mailFeedbackTableOverrideArn: t.isString(),
});

/** The custom-resource properties of the data override resolver, one incoming and one override ARN per table role. */
export type ResourceProperties = t.InferType<typeof isResourceProperties>;
