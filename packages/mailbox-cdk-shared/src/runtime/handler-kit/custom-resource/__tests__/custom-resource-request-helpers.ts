import { readCustomResourceRequest }               from '../custom-resource-request-reader';
import type { CustomResourceRequest, RequestType } from '../custom-resource-request';

export const STACK_ID             = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid';
export const PHYSICAL_RESOURCE_ID = 'physical-id-from-cloudformation';
export const RESPONSE_URL         = 'https://cloudformation-custom-resource-response.s3.amazonaws.com/signed';

/**
 * A request of the given type as CloudFormation sends it: an Update and a Delete carry a physical id, a Create
 * carries none. Every request carries a response URL, and the resource properties default to an empty declaration.
 */
export function cfnRequest(requestType: RequestType, resourceProperties: unknown = {}): CustomResourceRequest {
  const fields = {
    StackId:            STACK_ID,
    RequestId:          'request-123',
    LogicalResourceId:  'TestResource',
    ResponseURL:        RESPONSE_URL,
    ResourceProperties: resourceProperties,
  };
  if (requestType === 'Create') {
    return readCustomResourceRequest({ RequestType: requestType, ...fields });
  }
  return readCustomResourceRequest({ RequestType: requestType, PhysicalResourceId: PHYSICAL_RESOURCE_ID, ...fields });
}
