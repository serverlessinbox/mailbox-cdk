/// <reference types="jest" />

/**
 * Pins what StackHelpers puts in a consumer's stack: one shared Lambda per stack, and for each
 * resolver call a Custom::StackHelpers resource carrying the properties the Lambda reads and
 * exposing the attributes it answers with. A renamed property or attribute here is not caught by
 * the compiler, and CloudFormation would only report it when the resource is created.
 */

import { Match, Template }         from 'aws-cdk-lib/assertions';
import { Construct }               from 'constructs';

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

  describe('resolveMailboxData', () => {
    const { stack: mailboxStack, resolver: mailboxResolver } = createStackWithResolver();
    const data                                               = StackHelpers.getOrCreate(mailboxStack, mailboxResolver).resolveMailboxData(
      new Construct(mailboxStack, 'Caller'),
      'mailbox-data',
      { hostedZoneId: 'Z123', dataStackName: 'my-data-stack' },
    );
    const template                                           = Template.fromStack(mailboxStack);

    it('attaches a Custom::StackHelpers resource with the properties the Lambda reads', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        ServiceToken: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith(['Arn']) }),
        ServiceTimeout: '90',
        HostedZoneId: 'Z123',
        DataStackName: 'my-data-stack',
      });
    });

    it('returns the domainName and s3SafeDataStackName attributes of that resource', () => {
      const logicalId = logicalIdOfOnlyCustomResource(template);

      expect(mailboxStack.resolve(data.derivedDomainName)).toEqual({ 'Fn::GetAtt': [logicalId, 'domainName'] });
      expect(mailboxStack.resolve(data.derivedS3SafeDataStackName)).toEqual({
        'Fn::GetAtt': [logicalId, 's3SafeDataStackName'],
      });
    });
  });

  describe('resolveCognitoDomainPrefix', () => {
    const { stack: cognitoStack, resolver: cognitoResolver } = createStackWithResolver();
    const prefix                                             = StackHelpers.getOrCreate(cognitoStack, cognitoResolver).resolveCognitoDomainPrefix(
      new Construct(cognitoStack, 'Caller'),
      'cognito-prefix',
      'Z456',
    );
    const template                                           = Template.fromStack(cognitoStack);

    it('attaches a Custom::StackHelpers resource falling back to the stack name', () => {
      template.hasResourceProperties('Custom::StackHelpers', {
        HostedZoneId: 'Z456',
        Fallback: { Ref: 'AWS::StackName' },
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
        Salt: 'some-purpose',
        Range: '24',
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
    helpers.resolveMailboxData(callerScope, 'mailbox-data', { hostedZoneId: 'Z123', dataStackName: 'data' });
    helpers.resolveCognitoDomainPrefix(callerScope, 'cognito-prefix', 'Z123');

    const template = Template.fromStack(stack);

    template.resourceCountIs('Custom::StackHelpers', 2);
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });
});
