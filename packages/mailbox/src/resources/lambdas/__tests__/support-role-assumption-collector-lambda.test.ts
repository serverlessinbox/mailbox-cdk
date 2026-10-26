/// <reference types="jest" />

/**
 * SupportRoleAssumptionCollectorLambda: the role ARNs and both tier tag keys it hands the Go handler
 * by name (the handler recomputes the hop role's whole tag set, so a swapped or renamed value
 * stops expired cases from being revoked with no error at deploy time), the grants it requests for
 * itself on the config table and the support roles, and the collection schedule it registers. The
 * statements the support roles and the table render, and the rule the schedule renders, are pinned
 * by the units that own them.
 */

import { Match, Template }                                  from 'aws-cdk-lib/assertions';

import type { ISupportRoles }                               from '../../../contracts/support-roles';
import { SupportCollectionSchedule }                        from '../../events/support-collection-schedule';
import { SupportRoleAssumptionCollectorLambda }             from '../support-role-assumption-collector-lambda';

import { expectGrantedOnceTo, fakeDataTable }               from './lambda-wrapper-fakes';
import type { GrantSpy }                                    from './lambda-wrapper-fakes';
import { arrangeWrapperStack }                              from './lambda-wrapper-helpers';

jest.mock('../../events/support-collection-schedule');

/** Stands in for the `ISupportRoles`; every value is distinct, so a swapped environment variable is visible. */
interface FakeSupportRoles extends ISupportRoles {
  readonly grantTagWrites:        GrantSpy;
  readonly grantTagRead:          GrantSpy;
  readonly grantAssumptionLookup: GrantSpy;
}

function fakeSupportRoles(): FakeSupportRoles {
  return {
    hopRoleArn:            'arn:fake:hop-role',
    diagRoleArn:           'arn:fake:diag-role',
    configReadRoleArn:     'arn:fake:config-read-role',
    diagTagKey:            'fake:diag-tag',
    configReadTagKey:      'fake:config-read-tag',
    grantTagWrites:        jest.fn<void, Parameters<GrantSpy>>(),
    grantTagRead:          jest.fn<void, Parameters<GrantSpy>>(),
    grantAssumptionLookup: jest.fn<void, Parameters<GrantSpy>>(),
  };
}

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const supportRoles                = fakeSupportRoles();
  const configTable                 = fakeDataTable('config-table');
  const lambda                      = new SupportRoleAssumptionCollectorLambda(stack, 'support-role-assumption-collector', {
    supportRoles,
    configTable,
    artifactResolver,
  });

  return { lambda, stack, supportRoles, configTable };
}

describe('SupportRoleAssumptionCollectorLambda', () => {
  beforeEach(() => {
    jest.mocked(SupportCollectionSchedule).mockClear();
  });

  it('passes the support role ARNs, both tier tag keys and the config table name to the handler by name', () => {
    const { stack } = synthesize();

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CONFIG_TABLE_NAME:            'config-table',
          SUPPORT_HOP_ROLE_ARN:         'arn:fake:hop-role',
          SUPPORT_DIAG_ROLE_ARN:        'arn:fake:diag-role',
          SUPPORT_CONFIG_READ_ROLE_ARN: 'arn:fake:config-read-role',
          SUPPORT_DIAG_TAG_KEY:         'fake:diag-tag',
          SUPPORT_CONFIG_READ_TAG_KEY:  'fake:config-read-tag',
        }),
      },
    });
  });

  it('requests read-write on the config table for itself', () => {
    const { lambda, configTable } = synthesize();

    expectGrantedOnceTo(configTable.grantReadWrite, lambda);
  });

  it('requests the assumption lookup, the tag writes and the tag read on the support roles for itself', () => {
    const { lambda, supportRoles } = synthesize();

    expectGrantedOnceTo(supportRoles.grantAssumptionLookup, lambda);
    expectGrantedOnceTo(supportRoles.grantTagWrites, lambda);
    expectGrantedOnceTo(supportRoles.grantTagRead, lambda);
  });

  it('registers the collection schedule with itself as the target', () => {
    const { lambda } = synthesize();

    expect(SupportCollectionSchedule).toHaveBeenCalledTimes(1);
    expect(SupportCollectionSchedule).toHaveBeenCalledWith(lambda, 'collection-schedule', { target: lambda });
  });
});
