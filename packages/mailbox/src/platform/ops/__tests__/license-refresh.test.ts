/// <reference types="jest" />

/**
 * LicenseRefresh feature tests.
 *
 * The license refresher must run every day and straight after each deploy or update of the stack that
 * owns it; if either rule is missing or points at another stack, licenses silently go stale.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { VENDOR_ACCOUNT_ID }                    from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                             from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';
import * as cdk                                 from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }        from 'aws-cdk-lib';

import { DataTable }                            from '../../../resources/tables/data-tables';
import { LicenseRefresh }                       from '../license-refresh';

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
        packages: {
          'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
          'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
        },
        location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: stack.region,
      }),
      coreDomain: 'example.com',
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
    });
    template = Template.fromStack(stack);
  });

  describe('daily schedule', () => {
    function logicalIdOfSeededNumber(salt: string): string {
      const matches = Object.entries(template.findResources('Custom::StackHelpers', { Properties: { Salt: salt } }));
      expect(matches).toHaveLength(1);
      return matches[0][0];
    }

    it('resolves the hour from 24 values and the minute from 60, each with its own salt', () => {
      template.hasResourceProperties('Custom::StackHelpers', { Salt: 'license-refresh-hour', Range: '24' });
      template.hasResourceProperties('Custom::StackHelpers', { Salt: 'license-refresh-minute', Range: '60' });
      template.resourceCountIs('Custom::StackHelpers', 2);
    });

    it('refreshes once a day, at the resolved minute and hour', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: {
          'Fn::Join': ['', [
            'cron(',
            { 'Fn::GetAtt': [logicalIdOfSeededNumber('license-refresh-minute'), 'seededNumber'] },
            ' ',
            { 'Fn::GetAtt': [logicalIdOfSeededNumber('license-refresh-hour'), 'seededNumber'] },
            ' * * ? *)',
          ]],
        },
      });
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
