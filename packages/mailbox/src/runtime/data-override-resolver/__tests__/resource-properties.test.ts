import type * as t                             from 'typanion';

import type { ResourceProperties, TableRole }  from '../resource-properties-contract';
import { isResourceProperties }                from '../resource-properties';

/** The fields a shape lists by name, leaving out the index signature that lets the schema accept unlisted keys. */
type ListedFields<Shape> = { [Field in keyof Shape as string extends Field ? never : Field]: Shape[Field] };

/** The name of the table role in an incoming-ARN property name. */
type RoleOfIncomingArn<PropertyName> = PropertyName extends `${infer Role}IncomingArn` ? Role : never;

/** The properties as the schema types them. */
type SchemaProperties = ListedFields<t.InferType<typeof isResourceProperties>>;

const schemaToContract = (value: SchemaProperties): ResourceProperties => value;
const contractToSchema = (value: ResourceProperties): SchemaProperties => value;

const rolesOfSchemaToContract = (role: RoleOfIncomingArn<keyof SchemaProperties>): TableRole => role;
const rolesOfContractToSchema = (role: TableRole): RoleOfIncomingArn<keyof SchemaProperties> => role;

/**
 * Pins that the properties the construct writes (the contract) and the properties the Lambda validates (the
 * schema) describe the same shape, and that the table roles are the ones the schema has an incoming ARN for.
 * The assignments above fail to compile when either side gains, loses or retypes a field; the contract carries
 * no typanion, so the declarations a package publishes stay free of it.
 */
describe('data override resolver resource properties', () => {
  it('accepts a fully populated set of properties the construct writes', () => {
    const properties = contractToSchema({
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
    });

    expect(isResourceProperties(properties)).toBe(true);
    expect(schemaToContract(properties)).toBe(properties);
  });

  it('has a table role for every incoming-ARN property of the schema', () => {
    const roles: readonly TableRole[] = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'];

    expect(roles.map((role) => rolesOfContractToSchema(role))).toEqual(roles);
    expect(roles.map((role) => rolesOfSchemaToContract(role))).toEqual(roles);
  });
});
