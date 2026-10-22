import { readCustomResourceRequest, type CustomResourceRequest } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { BootstrapUserProperties }                          from '../properties';

/** The keys, with the values they carry, that CloudFormation hands the Lambda for the bootstrap user resource. */
export type TemplateProperties = BootstrapUserProperties & {
  readonly ServiceToken:   string;
  readonly ServiceTimeout: string;
};

export const FUNCTION_ARN         = 'arn:aws:lambda:us-east-1:123456789012:function:bootstrap-user';
export const STACK_ID             = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid';
export const USER_POOL_ID         = 'us-east-1_12345678';
export const PHYSICAL_RESOURCE_ID = 'BootstrapUser:us-east-1_12345678:admin';

/** The properties of a request as the template sends them, with the keys CloudFormation and CDK add beside the construct's own. */
export function templateProperties(overrides: Partial<TemplateProperties> = {}): TemplateProperties {
  return {
    ServiceToken:            FUNCTION_ARN,
    ServiceTimeout:          '240',
    userPoolId:              USER_POOL_ID,
    responseContractVersion: '1',
    ...overrides,
  };
}

export function request(
  requestType: 'Create' | 'Update' | 'Delete',
  resourceProperties: unknown = templateProperties(),
): CustomResourceRequest {
  return readCustomResourceRequest({
    RequestType:       requestType,
    StackId:           STACK_ID,
    RequestId:         'request-id-1',
    LogicalResourceId: 'BootstrapUserResource',
    ...(requestType === 'Create' ? {} : { PhysicalResourceId: PHYSICAL_RESOURCE_ID }),
    ResourceProperties: resourceProperties,
  });
}
