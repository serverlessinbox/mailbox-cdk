/// <reference types="jest" />

/**
 * DataConfigTable grant tests.
 *
 * Pin the DynamoDB action, resource ARN and conditions that `grantActiveSieveScriptUpdate` renders, and that it adds
 * no KMS statement. A widened grant lets a Lambda write config rows it is not listed for; a dropped `LeadingKeys`,
 * `Attributes` or `ReturnValues` condition lets it write other attributes or other item kinds.
 */

import {
  actionsOf,
  resourcesOf,
  statementsForRole,
  type PolicyStatementJson,
}                                        from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                      from 'aws-cdk-lib/assertions';
import { Table }                         from 'aws-cdk-lib/aws-dynamodb';
import * as iam                          from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { defaultCfnResource }            from '../../../utils/cfn-resource';
import { DataConfigTable }               from '../data-config-table';

/** One statement the grant renders, reduced to what the grant decides: actions, resources and conditions. */
interface AccessStatement {
  readonly actions:   string[];
  readonly resources: unknown[];
  readonly condition: unknown;
}

const TABLE_ARN = 'arn:aws:dynamodb:us-west-2:123456789012:table/config';

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function summarise(statement: PolicyStatementJson): AccessStatement {
  return { actions: actionsOf(statement).sort(), resources: resourcesOf(statement), condition: statement.Condition };
}

/** The statements `grantActiveSieveScriptUpdate` renders on a fresh role. */
function grantedStatements(): AccessStatement[] {
  const stack = createStack();
  const table = Table.fromTableAttributes(stack, 'config-table', { tableArn: TABLE_ARN, grantIndexPermissions: true });
  const role  = new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  new DataConfigTable(table).grantActiveSieveScriptUpdate(role);

  const template = Template.fromStack(stack);
  return statementsForRole(template, stack.getLogicalId(defaultCfnResource(role))).map(summarise);
}

describe('DataConfigTable', () => {
  it('grantActiveSieveScriptUpdate updates only the active Sieve script pointer on account items', () => {
    expect(grantedStatements()).toEqual([
      {
        actions:   ['dynamodb:UpdateItem'],
        resources: [TABLE_ARN],
        condition: {
          'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['TENANT#*#ACCOUNT#*'] },
          'ForAllValues:StringEquals': {
            'dynamodb:Attributes':   ['pk', 'sk', 'activeSieveScriptId'],
            'dynamodb:ReturnValues': ['NONE'],
          },
        },
      },
    ]);
  });

  it('grantActiveSieveScriptUpdate adds no kms statement', () => {
    const kmsActions = grantedStatements()
      .flatMap((statement) => statement.actions)
      .filter((action) => action.startsWith('kms:'));

    expect(kmsActions).toEqual([]);
  });
});
