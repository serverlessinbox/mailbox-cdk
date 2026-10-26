/// <reference types="jest" />

/**
 * Pins what StackHelpers puts in a consumer's stack: one shared Lambda per stack, and for each
 * resolver call a Custom::StackHelpers resource carrying the properties the Lambda reads and
 * exposing the attributes it answers with. A renamed property or attribute here is not caught by
 * the compiler, and CloudFormation would only report it when the resource is created.
 */

import { Match, Template }         from 'aws-cdk-lib/assertions';
import * as cdk                    from 'aws-cdk-lib';
import { Construct }               from 'constructs';

import { StackHelpersLambda }      from '../resources/lambdas/stack-helpers-lambda';
import { StackHelpers }            from '../stack-helpers';

import { createStackWithResolver } from './stack-helpers-helpers';

describe('StackHelpers', () => {
  const { stack, resolver } = createStackWithResolver();

  function logicalIdOfOnlyCustomResource(template: Template): string {
    const logicalIds = Object.keys(template.findResources('Custom::StackHelpers'));
    expect(logicalIds).toHaveLength(1);
    return logicalIds[0];
  }

  describe('getOrCreate', () => {
    it('returns the same instance on every call for one stack', () => {
      const { stack: freshStack, resolver: freshResolver } = createStackWithResolver();

      expect(StackHelpers.getOrCreate(freshStack, freshResolver)).toBe(StackHelpers.getOrCreate(freshStack, freshResolver));
    });

    it('places the singleton under the stack\'s shared group', () => {
      const { stack: freshStack, resolver: freshResolver } = createStackWithResolver();

      expect(StackHelpers.getOrCreate(freshStack, freshResolver).node.path).toBe('TestStack/shared/stack-helpers');
    });

    it('synthesizes one Lambda however often it is called', () => {
      const { stack: freshStack, resolver: freshResolver } = createStackWithResolver();
      StackHelpers.getOrCreate(freshStack, freshResolver);
      StackHelpers.getOrCreate(freshStack, freshResolver);

      Template.fromStack(freshStack).resourceCountIs('AWS::Lambda::Function', 1);
    });
  });

  describe('resolveHostedZoneName', () => {
    const { stack: zoneStack, resolver: zoneResolver } = createStackWithResolver();
    const zoneName                                     = StackHelpers.getOrCreate(zoneStack, zoneResolver).resolveHostedZoneName(
      new Construct(zoneStack, 'Caller'),
      'zone-name',
      'Z123',
    );
    const template                                     = Template.fromStack(zoneStack);

    it('attaches a Custom::StackHelpers resource with the properties the Lambda reads', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        ServiceToken:   Match.objectLike({ 'Fn::GetAtt': Match.arrayWith(['Arn']) }),
        ServiceTimeout: '90',
        HostedZoneId:   'Z123',
      });
    });

    it('returns the domainName attribute of that resource', () => {
      const logicalId = logicalIdOfOnlyCustomResource(template);

      expect(zoneStack.resolve(zoneName)).toEqual({ 'Fn::GetAtt': [logicalId, 'domainName'] });
    });

    describe('the hosted zone read grant', () => {
      const grantHostedZoneRead = jest.spyOn(StackHelpersLambda.prototype, 'grantHostedZoneRead');

      function resolveZoneName(hostedZoneId: string): void {
        const { stack: freshStack, resolver: freshResolver } = createStackWithResolver();
        StackHelpers.getOrCreate(freshStack, freshResolver).resolveHostedZoneName(
          new Construct(freshStack, 'Caller'),
          'zone-name',
          hostedZoneId,
        );
      }

      beforeEach(() => {
        grantHostedZoneRead.mockClear();
      });

      afterAll(() => {
        grantHostedZoneRead.mockRestore();
      });

      it('is requested for the zone given', () => {
        resolveZoneName('Z123');

        expect(grantHostedZoneRead).toHaveBeenCalledTimes(1);
        expect(grantHostedZoneRead).toHaveBeenCalledWith('Z123');
      });

      it('is requested for a zone id that is only known at deploy time, even when it will turn out empty', () => {
        const zoneIdToken = cdk.Lazy.string({ produce: () => '' });

        resolveZoneName(zoneIdToken);

        expect(grantHostedZoneRead).toHaveBeenCalledTimes(1);
        expect(grantHostedZoneRead).toHaveBeenCalledWith(zoneIdToken);
      });

      it('is not requested for a literal empty zone id', () => {
        resolveZoneName('');

        expect(grantHostedZoneRead).not.toHaveBeenCalled();
      });
    });
  });

  describe('resolveS3SafeStackName', () => {
    const { stack: nameStack, resolver: nameResolver } = createStackWithResolver();
    const s3SafeName                                   = StackHelpers.getOrCreate(nameStack, nameResolver).resolveS3SafeStackName(
      new Construct(nameStack, 'Caller'),
      's3-safe-name',
      'my-data-stack',
    );
    const template                                     = Template.fromStack(nameStack);

    it('attaches a Custom::StackHelpers resource with the stack name and no hosted zone', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        ServiceTimeout: '90',
        DataStackName:  'my-data-stack',
        HostedZoneId:   Match.absent(),
      });
    });

    it('returns the s3SafeDataStackName attribute of that resource', () => {
      const logicalId = logicalIdOfOnlyCustomResource(template);

      expect(nameStack.resolve(s3SafeName)).toEqual({ 'Fn::GetAtt': [logicalId, 's3SafeDataStackName'] });
    });
  });

  describe('resolveCognitoDomainPrefix', () => {
    const { stack: cognitoStack, resolver: cognitoResolver } = createStackWithResolver();
    const prefix                                             = StackHelpers.getOrCreate(cognitoStack, cognitoResolver).resolveCognitoDomainPrefix(
      new Construct(cognitoStack, 'Caller'),
      'cognito-prefix',
      'mail.example.com',
    );
    const template                                           = Template.fromStack(cognitoStack);

    it('attaches a Custom::StackHelpers resource sending the domain name, with no hosted zone, falling back to the stack name', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        DomainName:   'mail.example.com',
        HostedZoneId: Match.absent(),
        Fallback:     { Ref: 'AWS::StackName' },
      });
    });

    it('returns the cognitoDomainPrefix attribute of that resource', () => {
      const logicalId = logicalIdOfOnlyCustomResource(template);

      expect(cognitoStack.resolve(prefix)).toEqual({ 'Fn::GetAtt': [logicalId, 'cognitoDomainPrefix'] });
    });
  });

  describe('resolveSeededNumber', () => {
    const { stack: seededStack, resolver: seededResolver } = createStackWithResolver();
    const seededNumber                                     = StackHelpers.getOrCreate(seededStack, seededResolver).resolveSeededNumber(
      new Construct(seededStack, 'Caller'),
      'seeded-number',
      { salt: 'some-purpose', range: 24 },
    );
    const template                                         = Template.fromStack(seededStack);

    it('attaches a Custom::StackHelpers resource sending the salt and the range as strings', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        ServiceTimeout: '90',
        Salt:           'some-purpose',
        Range:          '24',
      });
    });

    it('returns the seededNumber attribute of that resource', () => {
      const logicalId = logicalIdOfOnlyCustomResource(template);

      expect(seededStack.resolve(seededNumber)).toEqual({ 'Fn::GetAtt': [logicalId, 'seededNumber'] });
    });
  });

  it('gives every resolver call its own resource while the Lambda stays shared', () => {
    const helpers     = StackHelpers.getOrCreate(stack, resolver);
    const callerScope = new Construct(stack, 'CallerScope');
    helpers.resolveHostedZoneName(callerScope, 'zone-name', 'Z123');
    helpers.resolveCognitoDomainPrefix(callerScope, 'cognito-prefix', 'example.com');

    const template = Template.fromStack(stack);

    template.resourceCountIs('Custom::StackHelpers', 2);
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });
});
