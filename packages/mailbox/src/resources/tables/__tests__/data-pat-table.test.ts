/// <reference types="jest" />

/**
 * DataPatTable grant tests.
 *
 * Pin the DynamoDB actions, resource ARNs and key conditions each token-table grant renders, and that no grant
 * adds a KMS statement. A widened grant lets a Lambda read or write token rows it is not listed for; a dropped
 * `LeadingKeys` or `Attributes` condition lets it reach rows of another kind.
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
import { DataPatTable }                  from '../data-pat-table';
import type { IPatTable }                from '../data-pat-table';

type GrantMethod = Exclude<keyof IPatTable, 'tableName' | 'tableArn'>;

/** One statement a grant renders, reduced to what the grant decides: actions, resources and conditions. */
interface AccessStatement {
  readonly actions:   string[];
  readonly resources: unknown[];
  readonly condition: unknown;
}

const TABLE_ARN = 'arn:aws:dynamodb:us-west-2:123456789012:table/pat';

const GRANT_METHODS: readonly GrantMethod[] = [
  'grantPatLookup',
  'grantPatManage',
  'grantPatRevokeForPrincipal',
  'grantPatExpiryNotify',
];

function createStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function summarise(statement: PolicyStatementJson): AccessStatement {
  return { actions: actionsOf(statement).sort(), resources: resourcesOf(statement), condition: statement.Condition };
}

/** The statements one grant of `method` renders on a fresh role. */
function grantedStatements(method: GrantMethod): AccessStatement[] {
  const stack = createStack();
  const table = Table.fromTableAttributes(stack, 'pat-table', { tableArn: TABLE_ARN, grantIndexPermissions: true });
  const role  = new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });

  new DataPatTable(table)[method](role);

  const template = Template.fromStack(stack);
  return statementsForRole(template, stack.getLogicalId(defaultCfnResource(role))).map(summarise);
}

describe('DataPatTable', () => {
  it('grantPatLookup reads a token row by its PAT key and updates only lastUsedAt on it', () => {
    expect(grantedStatements('grantPatLookup')).toEqual([
      {
        actions:   ['dynamodb:GetItem'],
        resources: [TABLE_ARN],
        condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['PAT#*'] } },
      },
      {
        actions:   ['dynamodb:UpdateItem'],
        resources: [TABLE_ARN],
        condition: {
          'ForAllValues:StringLike':   { 'dynamodb:LeadingKeys': ['PAT#*'] },
          'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['pk', 'sk', 'lastUsedAt'] },
        },
      },
    ]);
  });

  it('grantPatManage reads and writes the table and queries the gsi1 index only', () => {
    expect(grantedStatements('grantPatManage')).toEqual([
      {
        actions:   ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [TABLE_ARN],
        condition: undefined,
      },
      {
        actions:   ['dynamodb:Query'],
        resources: [TABLE_ARN, `${TABLE_ARN}/index/gsi1`],
        condition: undefined,
      },
    ]);
  });

  it('grantPatRevokeForPrincipal queries the gsi1 index and reads and updates token rows', () => {
    expect(grantedStatements('grantPatRevokeForPrincipal')).toEqual([
      {
        actions:   ['dynamodb:Query'],
        resources: [TABLE_ARN, `${TABLE_ARN}/index/gsi1`],
        condition: undefined,
      },
      {
        actions:   ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [TABLE_ARN],
        condition: undefined,
      },
    ]);
  });

  it('grantPatExpiryNotify queries the gsi2 index and reads and updates owner rows of the tenant', () => {
    expect(grantedStatements('grantPatExpiryNotify')).toEqual([
      {
        actions:   ['dynamodb:Query'],
        resources: [`${TABLE_ARN}/index/gsi2`],
        condition: undefined,
      },
      {
        actions:   ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [TABLE_ARN],
        condition: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['TENANT#*PAT_OWNER#*'] } },
      },
    ]);
  });

  it.each(GRANT_METHODS)('%s adds no kms statement', (method) => {
    const kmsActions = grantedStatements(method)
      .flatMap((statement) => statement.actions)
      .filter((action) => action.startsWith('kms:'));

    expect(kmsActions).toEqual([]);
  });
});
