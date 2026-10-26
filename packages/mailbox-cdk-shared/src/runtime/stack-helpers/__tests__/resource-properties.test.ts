/**
 * Pins which resource properties the stack-helpers Lambda accepts. Every property is optional and a string, `Range`
 * must also be a positive integer written as a string, and the keys CloudFormation adds, such as `ServiceToken`,
 * are tolerated.
 */

import { isStackHelpersResourceProperties } from '../resource-properties';

describe('isStackHelpersResourceProperties', () => {
  it('accepts every property as a string beside the keys CloudFormation adds', () => {
    expect(isStackHelpersResourceProperties({
      HostedZoneId:   'Z123',
      DomainName:     'mail.example.com',
      DataStackName:  'mail-data',
      Fallback:       'fallback',
      Salt:           'salt',
      Range:          '24',
      ServiceToken:   'arn:aws:lambda:x',
      ServiceTimeout: '90',
    })).toBe(true);
  });

  it('accepts properties without any of them', () => {
    expect(isStackHelpersResourceProperties({})).toBe(true);
  });

  it.each([
    ['a HostedZoneId that is not a string', { HostedZoneId: 5 }],
    ['a Range that is not a string', { Range: 24 }],
    ['a Range that is not a positive integer', { Range: '0' }],
  ])('rejects %s', (_name, properties) => {
    expect(isStackHelpersResourceProperties(properties)).toBe(false);
  });
});
