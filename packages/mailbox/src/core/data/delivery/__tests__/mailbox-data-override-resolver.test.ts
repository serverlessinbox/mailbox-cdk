/**
 * Coverage for the MailboxDataOverrideResolver construct. The synthesized template is what reaches the
 * resolver Lambda and the operator: the parameters are what the operator overwrites to redirect a
 * table, and the custom-resource properties are what the Lambda reads. A wrong parameter name leaves
 * the operator's override unread, and a wrong dynamic reference makes the resolver see the stack's own
 * ARN as the override, silently ignoring it.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Template, Match }                      from 'aws-cdk-lib/assertions';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import type { ResourceProperties, TableRole }   from '../../../../runtime/data-override-resolver/resource-properties';
import { MailboxDataOverrideResolver }          from '../mailbox-data-override-resolver';

const ROLES: readonly TableRole[] = ['configTable', 'itemTable', 'changelogTable', 'auditLogTable', 'mailFeedbackTable'];

const INCOMING_ARNS: Record<TableRole, string> = {
  configTable:       'arn:aws:dynamodb:us-west-2:123456789012:table/config',
  itemTable:         'arn:aws:dynamodb:us-west-2:123456789012:table/item',
  changelogTable:    'arn:aws:dynamodb:us-west-2:123456789012:table/changelog',
  auditLogTable:     'arn:aws:dynamodb:us-west-2:123456789012:table/audit',
  mailFeedbackTable: 'arn:aws:dynamodb:us-west-2:123456789012:table/feedback',
};

describe('MailboxDataOverrideResolver', () => {
  let stack: cdk.Stack;
  let resolver: MailboxDataOverrideResolver;
  let template: Template;

  beforeEach(() => {
    stack    = new cdk.Stack(new App(), 'TestStack', {
      synthesizer: new BootstraplessSynthesizer(),
      env:         { account: '123456789012', region: 'us-west-2' },
    });
    resolver = new MailboxDataOverrideResolver(stack, 'override-resolver', {
      configTableArn:       INCOMING_ARNS.configTable,
      itemTableArn:         INCOMING_ARNS.itemTable,
      changelogTableArn:    INCOMING_ARNS.changelogTable,
      auditLogTableArn:     INCOMING_ARNS.auditLogTable,
      mailFeedbackTableArn: INCOMING_ARNS.mailFeedbackTable,
      artifactResolver:     new PinnedArtifactResolver({
        packages:         { 'mailbox-cdk': { zone: ArtifactZone.REGIONAL, version: '1.0.0' } },
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
    });
    template = Template.fromStack(stack);
  });

  function parameterLogicalId(role: TableRole): string {
    const ids = Object.keys(template.findResources('AWS::SSM::Parameter', {
      Properties: { Name: { 'Fn::Join': ['', ['/serverlessinbox/', { Ref: 'AWS::StackName' }, `/data-override/${role}`]] } },
    }));
    expect(ids).toHaveLength(1);
    return ids[0];
  }

  it('declares one override parameter per role under the stack-scoped name, valued with the incoming table ARN', () => {
    template.resourceCountIs('AWS::SSM::Parameter', ROLES.length);

    for (const role of ROLES) {
      template.hasResourceProperties('AWS::SSM::Parameter', {
        Name:  { 'Fn::Join': ['', ['/serverlessinbox/', { Ref: 'AWS::StackName' }, `/data-override/${role}`]] },
        Value: INCOMING_ARNS[role],
        Type:  'String',
      });
    }
  });

  it('passes the resolver Lambda the incoming ARN and a dynamic reference to the override parameter per role', () => {
    const expected: Record<keyof ResourceProperties, unknown> = {
      configTableIncomingArn:       INCOMING_ARNS.configTable,
      configTableOverrideArn:       { 'Fn::Join': ['', ['{{resolve:ssm:', { Ref: parameterLogicalId('configTable') }, '}}']] },
      itemTableIncomingArn:         INCOMING_ARNS.itemTable,
      itemTableOverrideArn:         { 'Fn::Join': ['', ['{{resolve:ssm:', { Ref: parameterLogicalId('itemTable') }, '}}']] },
      changelogTableIncomingArn:    INCOMING_ARNS.changelogTable,
      changelogTableOverrideArn:    { 'Fn::Join': ['', ['{{resolve:ssm:', { Ref: parameterLogicalId('changelogTable') }, '}}']] },
      auditLogTableIncomingArn:     INCOMING_ARNS.auditLogTable,
      auditLogTableOverrideArn:     { 'Fn::Join': ['', ['{{resolve:ssm:', { Ref: parameterLogicalId('auditLogTable') }, '}}']] },
      mailFeedbackTableIncomingArn: INCOMING_ARNS.mailFeedbackTable,
      mailFeedbackTableOverrideArn: { 'Fn::Join': ['', ['{{resolve:ssm:', { Ref: parameterLogicalId('mailFeedbackTable') }, '}}']] },
    };

    template.resourceCountIs('Custom::MailboxDataOverrideResolver', 1);
    template.hasResourceProperties('Custom::MailboxDataOverrideResolver', Match.objectEquals({
      ServiceToken:   Match.anyValue(),
      ServiceTimeout: '120',
      ...expected,
    }));
  });

  it('answers each accessor with the resolver custom resource attribute of its role', () => {
    const [resolverId] = Object.keys(template.findResources('Custom::MailboxDataOverrideResolver'));

    expect(stack.resolve(resolver.getConfigTableArn())).toEqual({ 'Fn::GetAtt': [resolverId, 'configTableArn'] });
    expect(stack.resolve(resolver.getItemTableArn())).toEqual({ 'Fn::GetAtt': [resolverId, 'itemTableArn'] });
    expect(stack.resolve(resolver.getChangelogTableArn())).toEqual({ 'Fn::GetAtt': [resolverId, 'changelogTableArn'] });
    expect(stack.resolve(resolver.getAuditLogTableArn())).toEqual({ 'Fn::GetAtt': [resolverId, 'auditLogTableArn'] });
    expect(stack.resolve(resolver.getMailFeedbackTableArn())).toEqual({ 'Fn::GetAtt': [resolverId, 'mailFeedbackTableArn'] });
  });
});
