/// <reference types="jest" />

/**
 * Pins what `SupportRoleAssumptionCollectorLambda` passes to the Go handler and which grants it
 * takes: the support role ARNs and both tier tag keys the handler reads by name (it recomputes the
 * hop role's whole tag set), the grants for expiry enforcement, and the hourly schedule. A renamed
 * variable or a dropped grant stops expired cases from being revoked, with no error at deploy time.
 */

import { actionsOf }                                      from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                       from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                           from 'aws-cdk-lib/aws-dynamodb';
import type { Stack }                                     from 'aws-cdk-lib';

import { SupportRolesInfra }                              from '../../../platform/support/support-roles-infra';
import { DataTable }                                      from '../../tables/data-tables';
import { SupportRoleAssumptionCollectorLambda }           from '../support-role-assumption-collector-lambda';

import { arrangeWrapperStack, onlyLambdaOf }              from './lambda-wrapper-helpers';
import type { SynthesizedLambda }                         from './lambda-wrapper-helpers';

interface SynthesizedCollector extends SynthesizedLambda {
  readonly stack:    Stack;
  readonly template: Template;
  readonly roles:    SupportRolesInfra;
}

/** A token as the template renders it, as plain JSON. */
function templateValue(stack: Stack, value: string): unknown {
  return JSON.parse(JSON.stringify(stack.resolve(value))) as unknown;
}

function synthesize(): SynthesizedCollector {
  const { stack, artifactResolver } = arrangeWrapperStack();

  const roles = new SupportRolesInfra(stack, 'roles', { vendorAccountIds: ['999988887777'] });
  new SupportRoleAssumptionCollectorLambda(stack, 'support-role-assumption-collector', {
    supportRoles: roles,
    configTable:  new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
    artifactResolver,
  });

  const template = Template.fromStack(stack);
  return { stack, template, roles, ...onlyLambdaOf(template) };
}

describe('SupportRoleAssumptionCollectorLambda', () => {
  const { stack, template, roles, logicalId, environment, statements } = synthesize();

  it('passes the support role ARNs and both tier tag keys to the handler by name', () => {
    expect(environment).toMatchObject({
      SUPPORT_HOP_ROLE_ARN:         templateValue(stack, roles.hopRoleArn),
      SUPPORT_DIAG_ROLE_ARN:        templateValue(stack, roles.diagRoleArn),
      SUPPORT_CONFIG_READ_ROLE_ARN: templateValue(stack, roles.configReadRoleArn),
      SUPPORT_DIAG_TAG_KEY:         'serverless-inbox:support:diag',
      SUPPORT_CONFIG_READ_TAG_KEY:  'serverless-inbox:support:config-read',
    });
    expect(Object.keys(environment)).toContain('CONFIG_TABLE_NAME');
  });

  it('takes the CloudTrail lookup, the tag grants on the hop role, the tag listing and the table', () => {
    const actions = statements.flatMap((statement) => actionsOf(statement));

    expect(actions).toEqual(expect.arrayContaining([
      'cloudtrail:LookupEvents',
      'iam:TagRole',
      'iam:UntagRole',
      'iam:ListRoleTags',
      'dynamodb:PutItem',
    ]));
  });

  it('is invoked on an hourly schedule', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 * * * ? *)',
      Targets:            [{ Arn: { 'Fn::GetAtt': [logicalId, 'Arn'] }, Id: 'Target0' }],
    });
  });
});
