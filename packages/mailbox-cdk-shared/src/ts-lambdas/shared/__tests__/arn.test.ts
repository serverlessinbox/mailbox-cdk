/**
 * Coverage for `parseArn`: every ARN part comes out, for each separator form of the resource part
 * (`id`, `type/id`, `type:id`, `type:id:qualifier`), and a malformed ARN is rejected with an error that
 * names the ARN and the problem. Callers delete or look up resources by the parsed id, so a part
 * returned from the wrong position would act on a different resource than the ARN names.
 */

import { parseArn } from '../arn';

describe('parseArn', () => {
  it('parses a bare resource id, with empty region and account as S3 ARNs have them', () => {
    expect(parseArn('arn:aws:s3:::mailbox-blobs')).toEqual({
      partition: 'aws',
      service: 's3',
      region: '',
      account: '',
      resource: 'mailbox-blobs',
      resourceType: undefined,
      resourceId: 'mailbox-blobs',
      resourceName: 'mailbox-blobs',
      qualifier: undefined,
    });
  });

  it('parses type/id', () => {
    expect(parseArn('arn:aws-cn:iam::123456789012:role/detector-role')).toEqual({
      partition: 'aws-cn',
      service: 'iam',
      region: '',
      account: '123456789012',
      resource: 'role/detector-role',
      resourceType: 'role',
      resourceId: 'detector-role',
      resourceName: 'detector-role',
      qualifier: undefined,
    });
  });

  it('keeps every segment after the first slash in the id, and names the resource by the last one', () => {
    const parsed = parseArn('arn:aws:iam::123456789012:role/division/team/detector-role');

    expect(parsed.resourceType).toBe('role');
    expect(parsed.resourceId).toBe('division/team/detector-role');
    expect(parsed.resourceName).toBe('detector-role');
  });

  it('names a resource by the segment after the last slash of its id, whatever the separator form', () => {
    expect(parseArn('arn:aws:events:us-west-2:123456789012:rule/custom-bus/detector-rule').resourceName).toBe(
      'detector-rule',
    );
    expect(parseArn('arn:aws:logs:us-west-2:123456789012:log-group:/aws/lambda/fn:log-stream:s1').resourceName).toBe('fn');
  });

  it('parses type:id', () => {
    expect(parseArn('arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer')).toEqual({
      partition: 'aws',
      service: 'lambda',
      region: 'us-east-1',
      account: '123456789012',
      resource: 'function:blob-authorizer',
      resourceType: 'function',
      resourceId: 'blob-authorizer',
      resourceName: 'blob-authorizer',
      qualifier: undefined,
    });
  });

  it('parses type:id:qualifier, keeping any colon inside the qualifier', () => {
    const alias = parseArn('arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer:live');
    expect(alias.resourceType).toBe('function');
    expect(alias.resourceId).toBe('blob-authorizer');
    expect(alias.qualifier).toBe('live');

    const nested = parseArn('arn:aws:logs:us-west-2:123456789012:log-group:/aws/lambda/fn:log-stream:s1');
    expect(nested.resourceId).toBe('/aws/lambda/fn');
    expect(nested.qualifier).toBe('log-stream:s1');
  });

  describe('rejects a malformed ARN', () => {
    it.each<[string, string, string]>([
      ['has too few parts', 'arn:aws:lambda:us-east-1:123456789012', 'expected arn:partition:service:region:account:resource'],
      ['is not an ARN at all', 'blob-authorizer', 'expected arn:partition:service:region:account:resource'],
      ['has the wrong prefix', 'urn:aws:s3:::mailbox-blobs', 'expected the prefix "arn", got "urn"'],
      ['has an empty partition', 'arn::s3:::mailbox-blobs', 'the partition is empty'],
      ['has an empty service', 'arn:aws::::mailbox-blobs', 'the service is empty'],
      ['has an empty resource', 'arn:aws:s3:::', 'the resource is empty'],
      ['has an empty resource type', 'arn:aws:iam::123456789012:/detector-role', 'the resource type is empty'],
      ['has an empty id after a slash', 'arn:aws:iam::123456789012:role/', 'the resource id is empty'],
      ['has an empty id after a colon', 'arn:aws:lambda:us-east-1:123456789012:function:', 'the resource id is empty'],
      ['has an empty qualifier', 'arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer:', 'the qualifier is empty'],
    ])('when it %s', (_name, arn, problem) => {
      expect(() => parseArn(arn)).toThrow(`Invalid ARN "${arn}": ${problem}`);
    });
  });
});
