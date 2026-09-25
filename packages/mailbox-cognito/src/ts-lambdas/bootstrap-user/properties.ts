import * as t from 'typanion';

export const schema = t.isObject(
  {
    userPoolId: t.isString(),
    username: t.isOptional(t.isString()),
    groups: t.isOptional(t.isArray(t.isString())),
    temporaryPassword: t.isOptional(t.isString()),
  },
  { extra: t.isRecord(t.isUnknown()) },
);

export type BootstrapUserProperties = t.InferType<typeof schema>;
