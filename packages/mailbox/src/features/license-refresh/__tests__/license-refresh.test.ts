/// <reference types="jest" />

/**
 * LicenseRefresh feature tests.
 *
 * The license refresher must run every day and straight after each deploy or update of the stack that
 * owns it; if either rule is missing or points at another stack, licenses silently go stale.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { VENDOR_ACCOUNT_ID } from '@serverlessinbox/mailbox-cdk-shared';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { LicenseRefresh } from '../license-refresh';
import { DataTable } from '../../../data/data-tables';

describe('LicenseRefresh', () => {
  let stack: cdk.Stack;
  let template: Template;

  beforeEach(() => {
    stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    new LicenseRefresh(stack, 'license-refresh', {
      configTable: new DataTable(new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
      })),
      artifactResolver: new PinnedArtifactResolver({
        packages: { 'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      coreDomain: 'example.com',
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
    });
    template = Template.fromStack(stack);
  });

  it('refreshes once a day, at a minute and hour inside the day', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: Match.stringLikeRegexp('^cron\\((\\d|[1-5]\\d) (\\d|1\\d|2[0-3]) \\* \\* \\? \\*\\)$'),
    });
  });

  it('refreshes after the owning stack finishes a create or an update', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.cloudformation'],
        'detail-type': ['CloudFormation Stack Status Change'],
        detail: {
          'stack-id': [{ Ref: 'AWS::StackId' }],
          'status-details': { status: ['CREATE_COMPLETE', 'UPDATE_COMPLETE'] },
        },
      },
    });
  });

  it('invokes the refresher Lambda from both rules', () => {
    const rules = Object.values(template.findResources('AWS::Events::Rule'));

    expect(rules).toHaveLength(2);
    const targetArns = rules.map((rule) => rule.Properties.Targets[0].Arn);
    expect(targetArns[0]).toEqual(targetArns[1]);
    expect(targetArns[0]).toEqual({ 'Fn::GetAtt': [expect.stringContaining('handler'), 'Arn'] });
  });
});
