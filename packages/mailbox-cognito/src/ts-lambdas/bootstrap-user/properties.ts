import * as t from 'typanion';

// CloudFormation adds keys beside the ones the construct writes (`ServiceToken`, `ServiceTimeout`), so a key that
// is not listed is accepted.
export const isBootstrapUserProperties = t.isPartial({
  userPoolId: t.isString(),
  username: t.isOptional(t.isString()),
  groups: t.isOptional(t.isArray(t.isString())),
  temporaryPassword: t.isOptional(t.isString()),
  responseContractVersion: t.isOptional(t.isString()),
});

/**
 * The properties of the custom resource that creates the bootstrap user. The Lambda reads them and the
 * construct that declares the resource writes them, both through this type.
 */
export type BootstrapUserProperties = t.InferType<typeof isBootstrapUserProperties>;
