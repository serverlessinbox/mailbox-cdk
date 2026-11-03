/**
 * Pins which events are read as a custom-resource request: the three request types CloudFormation sends, each
 * with the ids its variant carries, the response URL it is answered at, and the resource properties it declares.
 * A Lambda that is handed anything else must reject it before it acts, because its handlers narrow on the request
 * type and read a physical id only where the variant has one.
 */

import { InvalidOwnInput }           from '../../errors/invalid-own-input';
import { readCustomResourceRequest } from '../custom-resource-request-reader';

const IDS = {
  StackId:           'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
  RequestId:         'request-123',
  LogicalResourceId: 'TestResource',
};

const RESPONSE_URL = 'https://cloudformation-custom-resource-response.s3.amazonaws.com/signed';

function rejectionOf(event: unknown): unknown {
  try {
    readCustomResourceRequest(event);
  } catch (failure) {
    return failure;
  }
  return undefined;
}

describe('readCustomResourceRequest', () => {
  it('reads a Create, which carries no physical id, together with its resource properties', () => {
    const event = { ...IDS, RequestType: 'Create', ResponseURL: RESPONSE_URL, ResourceProperties: { bucketName: 'my-bucket' } };

    expect(readCustomResourceRequest(event)).toEqual(event);
  });

  it('reads an Update with the physical id and the old properties CloudFormation sent', () => {
    const event = {
      ...IDS,
      RequestType:           'Update',
      PhysicalResourceId:    'physical-1',
      ResponseURL:           RESPONSE_URL,
      ResourceProperties:    { bucketName: 'new' },
      OldResourceProperties: { bucketName: 'old' },
    };

    expect(readCustomResourceRequest(event)).toEqual(event);
  });

  it('reads a Delete with the physical id CloudFormation sent', () => {
    const event = { ...IDS, RequestType: 'Delete', PhysicalResourceId: 'physical-1', ResponseURL: RESPONSE_URL, ResourceProperties: {} };

    expect(readCustomResourceRequest(event)).toEqual(event);
  });

  it.each(['Update', 'Delete'])('rejects a %s without a physical id as an InvalidOwnInput', (requestType) => {
    const failure = rejectionOf({ ...IDS, RequestType: requestType, ResponseURL: RESPONSE_URL, ResourceProperties: {} });

    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure).toHaveProperty('message', expect.stringContaining('Invalid custom-resource request'));
  });

  it('rejects a request type CloudFormation does not send as an InvalidOwnInput', () => {
    const failure = rejectionOf({ ...IDS, RequestType: 'Replace', PhysicalResourceId: 'physical-1', ResponseURL: RESPONSE_URL, ResourceProperties: {} });

    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure).toHaveProperty('message', expect.stringContaining('Invalid custom-resource request'));
  });

  it.each(['StackId', 'RequestId', 'LogicalResourceId'])('rejects a request without %s as an InvalidOwnInput naming it', (field) => {
    const failure = rejectionOf({ ...IDS, [field]: undefined, RequestType: 'Create', ResponseURL: RESPONSE_URL, ResourceProperties: {} });

    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure).toHaveProperty('message', expect.stringContaining(field));
  });

  it('rejects a request with no ResponseURL key as an InvalidOwnInput naming it', () => {
    const failure = rejectionOf({ ...IDS, RequestType: 'Create', ResourceProperties: {} });

    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure).toHaveProperty('message', expect.stringContaining('ResponseURL'));
  });

  it('rejects a request whose ResponseURL is undefined as an InvalidOwnInput naming it', () => {
    const failure = rejectionOf({ ...IDS, RequestType: 'Create', ResponseURL: undefined, ResourceProperties: {} });

    expect(failure).toBeInstanceOf(InvalidOwnInput);
    expect(failure).toHaveProperty('message', expect.stringContaining('ResponseURL'));
  });

  it('rejects a value that is not an object as an InvalidOwnInput', () => {
    expect(rejectionOf('Create')).toBeInstanceOf(InvalidOwnInput);
  });

  it('carries the rejected event with its response URL and service token redacted', () => {
    const failure = rejectionOf({
      ...IDS,
      RequestType:  'Replace',
      ResponseURL:  'https://cloudformation-custom-resource-response.s3.amazonaws.com/signed?X-Amz-Signature=abc',
      ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:handler',
    });

    expect(failure).toHaveProperty('input', expect.objectContaining({ RequestType: 'Replace', ResponseURL: '[redacted]', ServiceToken: '[redacted]' }));
    expect(failure).toHaveProperty('message', expect.not.stringContaining('X-Amz-Signature'));
  });
});
