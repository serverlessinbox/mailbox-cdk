import * as t from 'typanion';

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

export const isStackHelpersResourceProperties = t.isPartial({
  HostedZoneId: t.isOptional(t.isString()),
  DataStackName: t.isOptional(t.isString()),
  Fallback: t.isOptional(t.isString()),
  Salt: t.isOptional(t.isString()),
  Range: t.isOptional(t.cascade(t.isString(), [t.matchesRegExp(POSITIVE_INTEGER)])),
});

/**
 * The properties of a `Custom::StackHelpers` resource. `ServiceToken`, which CloudFormation adds to
 * every request, is deliberately not listed. `Range` is a positive integer written as a string, the
 * form in which custom-resource properties arrive.
 */
export type StackHelpersResourceProperties = t.InferType<typeof isStackHelpersResourceProperties>;
