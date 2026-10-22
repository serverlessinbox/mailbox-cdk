/// <reference types="jest" />

/**
 * Pins what an app gets from a HostedZoneLookup: exactly one Route 53 lookup for the zone id it was
 * given, and a zone whose name is that lookup's answer. Every construct that receives the zone
 * relies on it being the only lookup, so a second lookup per consumer, or a zone name that is not
 * the lookup's attribute, would break the one-lookup guarantee or name every endpoint wrongly.
 */

import { Template }                                           from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, CfnParameter, Stack } from 'aws-cdk-lib';

import { newDeployerTestStack }                               from '../../../__tests__/deployer-test-helpers';
import { HostedZoneLookup }                                   from '../hosted-zone-lookup';

describe('HostedZoneLookup', () => {
  it('adds one Custom::StackHelpers resource that looks up the given zone id', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    new HostedZoneLookup(stack, 'hosted-zone-lookup', { hostedZoneId: 'Z123', artifactResolver });

    const template = Template.fromStack(stack);
    template.resourceCountIs('Custom::StackHelpers', 1);
    template.hasResourceProperties('Custom::StackHelpers', { HostedZoneId: 'Z123' });
  });

  it('exposes the zone with the given id and the looked-up name as its zone name', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    const { hostedZone } = new HostedZoneLookup(stack, 'hosted-zone-lookup', { hostedZoneId: 'Z123', artifactResolver });

    const [logicalId] = Object.keys(Template.fromStack(stack).findResources('Custom::StackHelpers'));
    expect(hostedZone.hostedZoneId).toBe('Z123');
    expect(stack.resolve(hostedZone.zoneName)).toEqual({ 'Fn::GetAtt': [logicalId, 'domainName'] });
  });

  it('passes a CloudFormation parameter value on to the lookup and the zone', () => {
    const { stack, artifactResolver } = newDeployerTestStack();
    const parameter                   = new CfnParameter(stack, 'hostedZoneId', { type: 'String', default: '' });

    const { hostedZone } = new HostedZoneLookup(stack, 'hosted-zone-lookup', { hostedZoneId: parameter.valueAsString, artifactResolver });

    Template.fromStack(stack).hasResourceProperties('Custom::StackHelpers', { HostedZoneId: { Ref: 'hostedZoneId' } });
    expect(stack.resolve(hostedZone.hostedZoneId)).toEqual({ Ref: 'hostedZoneId' });
  });

  it('adds the lookup Lambda of the stack helpers once however many lookups the stack has', () => {
    const { stack, artifactResolver } = newDeployerTestStack();

    new HostedZoneLookup(stack, 'first', { hostedZoneId: 'Z111', artifactResolver });
    new HostedZoneLookup(stack, 'second', { hostedZoneId: 'Z222', artifactResolver });

    Template.fromStack(stack).resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('resolves the artifacts from the pinned versions of the package when no resolver is given', () => {
    const app   = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages:   { 'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' } },
        },
      },
    });
    const stack = new Stack(app, 'test-stack', { env: { account: '111122223333', region: 'us-west-2' }, synthesizer: new BootstraplessSynthesizer() });

    new HostedZoneLookup(stack, 'hosted-zone-lookup', { hostedZoneId: 'Z123' });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Code: { S3Key: 'serverlessinbox/packages/mailbox-cdk-shared/releases/v1.0.0/lambdas/stack-helpers.zip' },
    });
  });
});
