/// <reference types="jest" />

/**
 * LicenseRefresherLambda: the environment it hands the Go handler, the read-write grant it requests
 * on the config table, the execute-api:Invoke statement it adds itself for the vendor license API,
 * and the two triggers it registers for itself: the daily schedule with the hour and minute it is
 * given, and the stack-deployed event. The statement the grant renders and the rule each trigger
 * renders are pinned by the table and the triggers, not here.
 */

import { statementsForAction }                              from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { VENDOR_ACCOUNT_ID }                                from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                         from 'aws-cdk-lib/assertions';

import { LicenseRefreshSchedule }                           from '../../events/license-refresh-schedule';
import { LicenseRefresherLambda }                           from '../license-refresher-lambda';

import { expectGrantedOnceTo, fakeDataTable }               from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                from './lambda-wrapper-helpers';

jest.mock('../../events/license-refresh-schedule');

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeDataTable('config-table');
  const lambda                      = new LicenseRefresherLambda(stack, 'license-refresher', {
    configTable,
    artifactResolver,
    coreDomain:       'example.com',
    vendorAccountIds: [VENDOR_ACCOUNT_ID],
    scheduleHour:     '5',
    scheduleMinute:   '9',
  });
  const template                    = Template.fromStack(stack);

  return { lambda, configTable, template, ...onlyLambdaOf(template) };
}

describe('LicenseRefresherLambda', () => {
  beforeEach(() => {
    jest.mocked(LicenseRefreshSchedule).mockClear();
  });

  it('passes the config table name and the core domain to the handler', () => {
    expect(synthesize().environment).toMatchObject({ CONFIG_TABLE_NAME: 'config-table', CORE_DOMAIN: 'example.com' });
  });

  it('requests read-write on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantReadWrite, lambda);
  });

  it('scopes execute-api:Invoke to the refresh-license path of the vendor account', () => {
    expect(statementsForAction(synthesize().template, 'execute-api:Invoke')).toEqual([
      {
        Action:   'execute-api:Invoke',
        Effect:   'Allow',
        Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:execute-api:*:${VENDOR_ACCOUNT_ID}:*/*/POST/refresh-license`]] },
      },
    ]);
  });

  it('registers the daily schedule with itself as the target and the given hour and minute', () => {
    const { lambda } = synthesize();

    expect(LicenseRefreshSchedule).toHaveBeenCalledTimes(1);
    expect(LicenseRefreshSchedule).toHaveBeenCalledWith(lambda, 'refresh-schedule', { target: lambda, hour: '5', minute: '9' });
  });

  it('registers a stack-deployed event that invokes itself', () => {
    const { template, logicalId } = synthesize();

    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: [{ Arn: { 'Fn::GetAtt': [logicalId, 'Arn'] }, Id: 'Target0' }],
    });
  });
});
