/// <reference types="jest" />

/**
 * LicenseRefresherLambda: its invocation by the daily schedule at the given time and by the stack-deployed event.
 */

import { VENDOR_ACCOUNT_ID }                         from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                           from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                      from 'aws-cdk-lib/aws-dynamodb';
import type * as cdk                                 from 'aws-cdk-lib';

import { DataTable }                                 from '../../tables/data-tables';
import { LicenseRefresherLambda }                    from '../license-refresher-lambda';

import { arrangeWrapperStack }                       from './lambda-wrapper-helpers';

describe('LicenseRefresherLambda', () => {
  let stack: cdk.Stack;
  let template: Template;

  beforeEach(() => {
    const arrangement = arrangeWrapperStack();
    stack             = arrangement.stack;

    new LicenseRefresherLambda(stack, 'license-refresher', {
      configTable:      new DataTable(new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
      })),
      artifactResolver: arrangement.artifactResolver,
      coreDomain:       'example.com',
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
      scheduleHour:     '5',
      scheduleMinute:   '9',
    });

    template = Template.fromStack(stack);
  });

  it('is invoked by the daily schedule at the given time and by the stack-deployed event', () => {
    const targets = [{ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^licenserefresher'), 'Arn'] }, Id: 'Target0' }];

    template.resourceCountIs('AWS::Events::Rule', 2);
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(9 5 * * ? *)', Targets: targets });
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.cloudformation'] }),
      Targets:      targets,
    });
  });
});
