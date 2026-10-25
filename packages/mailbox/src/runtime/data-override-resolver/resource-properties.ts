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
