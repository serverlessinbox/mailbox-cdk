import * as t from 'typanion';

const resourcePropertyFields = {
  configTableIncomingArn:       t.isString(),
  configTableOverrideArn:       t.isString(),
  itemTableIncomingArn:         t.isString(),
  itemTableOverrideArn:         t.isString(),
  changelogTableIncomingArn:    t.isString(),
  changelogTableOverrideArn:    t.isString(),
  auditLogTableIncomingArn:     t.isString(),
  auditLogTableOverrideArn:     t.isString(),
  mailFeedbackTableIncomingArn: t.isString(),
  mailFeedbackTableOverrideArn: t.isString(),
};

/**
 * Schema of the custom-resource properties the construct hands to the resolver Lambda: for each data
 * table role, the stack's own table ARN and the operator-overridable parameter's current value.
 * CloudFormation adds keys of its own (such as `ServiceToken`), so unlisted keys are accepted.
 */
export const isResourceProperties = t.isPartial(resourcePropertyFields);

/** The custom-resource properties of the data override resolver, one incoming and one override ARN per table role. */
export type ResourceProperties = t.InferType<typeof isResourceProperties>;

/** The name of the table role in an incoming-ARN property name. */
type RoleOfIncomingArn<PropertyName> = PropertyName extends `${infer Role}IncomingArn` ? Role : never;

/** The data tables whose ARN the resolver decides, by the role each plays in the mailbox; one per incoming-ARN property. */
export type TableRole = RoleOfIncomingArn<keyof typeof resourcePropertyFields>;
