import * as t from 'typanion';

export const isStackHelpersResourceProperties = t.isPartial({
  HostedZoneId: t.isOptional(t.isString()),
  DataStackName: t.isOptional(t.isString()),
  Fallback: t.isOptional(t.isString()),
});

/**
 * The properties of a `Custom::StackHelpers` resource. `ServiceToken`, which CloudFormation adds to
 * every request, is deliberately not listed.
 */
export type StackHelpersResourceProperties = t.InferType<typeof isStackHelpersResourceProperties>;
