import type { Unbranded }                                                  from '../../../handler-kit/branded';
import type { StackDeployerProperties }                                    from '../stack-deployer-properties-contract';
import { isStackDeployerProperties, type BrandedStackDeployerProperties }  from '../stack-deployment';

/** The fields a shape lists by name, leaving out the index signature that lets the schema accept unlisted keys. */
type ListedFields<Shape> = { [Field in keyof Shape as string extends Field ? never : Field]: Shape[Field] };

/** The properties as the schema types them, with the identifiers as plain strings. */
type SchemaProperties = ListedFields<Unbranded<BrandedStackDeployerProperties>>;

const schemaToContract = (value: SchemaProperties): StackDeployerProperties => value;
const contractToSchema = (value: StackDeployerProperties): SchemaProperties => value;

/**
 * Pins that the properties the construct writes (the contract) and the properties the Lambda validates (the
 * schema) describe the same shape. The two assignments above fail to compile when either side gains, loses or
 * retypes a field; the contract carries no typanion, so the declarations a package publishes stay free of it.
 */
describe('stack deployer properties', () => {
  it('accepts a fully populated set of properties the construct writes', () => {
    const properties = contractToSchema({
      ServiceToken:          'arn:aws:lambda:eu-west-1:123456789012:function:starter',
      stackName:             'sub-stack',
      templateUrl:           'https://bucket.s3.amazonaws.com/template.json',
      parameters:            { nameBase: 'base' },
      tags:                  { owner: 'mailbox' },
      terminationProtection: 'true',
      region:                'us-east-1',
      preserveOnDelete:      false,
    });

    expect(isStackDeployerProperties(properties)).toBe(true);
    expect(schemaToContract(properties)).toBe(properties);
  });
});
