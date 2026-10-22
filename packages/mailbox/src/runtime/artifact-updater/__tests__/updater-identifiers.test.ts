/// <reference types="jest" />

/**
 * Pins which ARNs the updater accepts as a Lambda function or a CloudFront distribution. The check keeps a
 * resource of another kind from reaching an update path that would call the wrong API on it.
 */

import { toDistributionArn, toLambdaFunctionArn } from '../updater-identifiers';

describe('toLambdaFunctionArn', () => {
  it('accepts a Lambda function ARN', () => {
    expect(toLambdaFunctionArn('arn:aws:lambda:us-east-1:123456789012:function:mailbox-go')).toBe(
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
    );
  });

  it.each([
    { value: 'a CloudFront distribution', arn: 'arn:aws:cloudfront::123456789012:distribution/ABCD1234' },
    { value: 'a Lambda layer', arn: 'arn:aws:lambda:us-east-1:123456789012:layer:shared:3' },
    { value: 'a CloudFront function', arn: 'arn:aws:cloudfront::123456789012:function/redirect' },
    { value: 'text that is not an ARN', arn: 'mailbox-go' },
  ])('rejects $value', ({ arn }) => {
    expect(() => toLambdaFunctionArn(arn)).toThrow();
  });

  it('names the ARN and what was expected when the ARN is of another kind', () => {
    const arn = 'arn:aws:cloudfront::123456789012:distribution/ABCD1234';

    expect(() => toLambdaFunctionArn(arn)).toThrow(`Invalid ARN "${arn}": expected a lambda function`);
  });
});

describe('toDistributionArn', () => {
  it('accepts a CloudFront distribution ARN', () => {
    expect(toDistributionArn('arn:aws:cloudfront::123456789012:distribution/ABCD1234')).toBe(
      'arn:aws:cloudfront::123456789012:distribution/ABCD1234',
    );
  });

  it('rejects the ARN of a Lambda function', () => {
    const arn = 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go';

    expect(() => toDistributionArn(arn)).toThrow(`Invalid ARN "${arn}": expected a cloudfront distribution`);
  });
});
