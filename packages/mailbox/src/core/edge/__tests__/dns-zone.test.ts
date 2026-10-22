/// <reference types="jest" />

/**
 * DnsZone is the only holder of the hosted zone for the constructs that manage records in it: the
 * grant must name exactly this zone and only the record actions, since a wider one lets the grantee
 * change records of every zone in the account.
 */

import { Template }                             from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal }               from 'aws-cdk-lib/aws-iam';
import { HostedZone }                           from 'aws-cdk-lib/aws-route53';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';

import { DnsZone }                              from '../dns-zone';

const HOSTED_ZONE_ID = 'Z0123456789';

function newDnsZone(stack: Stack): DnsZone {
  return new DnsZone(HostedZone.fromHostedZoneAttributes(stack, 'zone', { hostedZoneId: HOSTED_ZONE_ID, zoneName: 'example.com' }));
}

describe('DnsZone', () => {
  let stack: Stack;

  beforeEach(() => {
    stack = new Stack(new App(), 'TestStack', {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  it('exposes the id of the hosted zone', () => {
    expect(newDnsZone(stack).hostedZoneId).toBe(HOSTED_ZONE_ID);
  });

  it('lets the grantee change and read the records of this zone only', () => {
    const grantee = new Role(stack, 'grantee', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });

    newDnsZone(stack).grantRecordManagement(grantee);

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action:   ['route53:ChangeResourceRecordSets', 'route53:GetHostedZone'],
            Effect:   'Allow',
            Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:route53:::hostedzone/${HOSTED_ZONE_ID}`]] },
          },
        ],
      },
    });
  });
});
