import type * as t                             from 'typanion';

import type { ResourceProperties, TableRole }  from '../resource-properties-contract';
import { isResourceProperties }                from '../resource-properties';

/** The fields a shape lists by name, leaving out the index signature that lets the schema accept unlisted keys. */
type ListedFields<Shape> = { [Field in keyof Shape as string extends Field ? never : Field]: Shape[Field] };

/** The name of the table role in an incoming-ARN property name. */
type RoleOfIncomingArn<PropertyName> = PropertyName extends `${infer Role}IncomingArn` ? Role : never;

/** The properties as the schema types them. */
type SchemaProperties = ListedFields<t.InferType<typeof isResourceProperties>>;

/** Resolves to `true` when both types are assignable to each other, and to `never` otherwise. */
type SameType<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : never) : never;

/** Fails to compile when either side gains, loses or retypes a field. */
export const contractMatchesSchema: SameType<SchemaProperties, ResourceProperties> = true;

/** Fails to compile when a table role has no incoming-ARN property in the schema, or the schema has one for no role. */
export const rolesMatchSchema: SameType<RoleOfIncomingArn<keyof SchemaProperties>, TableRole> = true;

/**
 * Pins that the properties the construct writes (the contract) and the properties the Lambda validates (the
 * schema) describe the same shape, and that the table roles are the ones the schema has an incoming ARN for.
 * The two type constants above carry that check, and `tsc` (the first half of `yarn test`) fails on them; the
 * contract carries no typanion, so the declarations a package publishes stay free of it. The tests below pin
 * what the schema does at run time.
 */
describe('data override resolver resource properties', () => {
  const properties = {
    configTableIncomingArn:       'arn:aws:dynamodb:eu-west-1:123456789012:table/config',
    configTableOverrideArn:       'arn:aws:dynamodb:eu-west-1:123456789012:table/config-restored',
    itemTableIncomingArn:         'arn:aws:dynamodb:eu-west-1:123456789012:table/item',
    itemTableOverrideArn:         'arn:aws:dynamodb:eu-west-1:123456789012:table/item-restored',
    changelogTableIncomingArn:    'arn:aws:dynamodb:eu-west-1:123456789012:table/changelog',
    changelogTableOverrideArn:    'arn:aws:dynamodb:eu-west-1:123456789012:table/changelog-restored',
    auditLogTableIncomingArn:     'arn:aws:dynamodb:eu-west-1:123456789012:table/auditlog',
    auditLogTableOverrideArn:     'arn:aws:dynamodb:eu-west-1:123456789012:table/auditlog-restored',
    mailFeedbackTableIncomingArn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/mailfeedback',
    mailFeedbackTableOverrideArn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/mailfeedback-restored',
  } satisfies ResourceProperties;

  it('accepts the properties the construct writes, with the keys CloudFormation adds', () => {
    const sent = { ServiceToken: 'arn:aws:lambda:eu-west-1:123456789012:function:resolver', ServiceTimeout: '120', ...properties };

    expect(isResourceProperties(sent)).toBe(true);
  });

  it('rejects properties that lack an ARN', () => {
    const withoutItemOverride = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'itemTableOverrideArn'));

    expect(isResourceProperties(withoutItemOverride)).toBe(false);
  });
});
