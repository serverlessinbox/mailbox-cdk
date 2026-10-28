import {
  actionsOf,
  allPolicyStatements,
  resourcesOf,
  statementsForRole,
  type PolicyStatementJson,
} from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { PositionHash, StackIdentity }                                  from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                                              from 'aws-cdk-lib/assertions';
import * as iam                                                         from 'aws-cdk-lib/aws-iam';
import * as kms                                                         from 'aws-cdk-lib/aws-kms';
import * as cdk                                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                                from 'aws-cdk-lib';

import { defaultCfnResource }                                           from '../../../utils/cfn-resource';
import { AuthKeyStoreTable }                                            from '../auth-key-store-table';
import type { IAuthKeyStoreTable }                                      from '../auth-key-store-table';

/**
 * AuthKeyStoreTable tests.
 *
 * Pin the table definition the signing-key readers and the updater depend on (pk/sk keys, on-demand
 * billing, the physical name), and the IAM each grant method renders: one DynamoDB statement per table
 * access, limited to one `dynamodb:LeadingKeys` value, plus a KMS statement only when a customer key
 * encrypts the table. A regression breaks key lookup, widens one caller's reach into another item type,
 * or hands the customer key's statements to a caller that never reads encrypted items.
 */

type GrantMethod = Exclude<keyof IAuthKeyStoreTable, 'tableName' | 'tableArn'>;

const GRANT_METHODS: readonly GrantMethod[] = [
  'grantReadJwks',
  'grantReadHmac',
  'grantManageHmac',
  'grantManageJwks',
  'grantManageImportKeys',
  'grantReadImportPublicKey',
  'grantReadImportPrivateKey',
];

interface TableAccess {
  readonly actions:     string[];
  readonly leadingKeys: unknown;
}

interface RoleAccess {
  readonly role:        string;
  readonly leadingKeys: unknown;
}

function createStack(): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function newRole(stack: cdk.Stack, id: string): iam.Role {
  return new iam.Role(stack, id, {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  });
}

/** The `dynamodb:LeadingKeys` value a statement's condition names; undefined when it has no such condition. */
function leadingKeysOf(statement: PolicyStatementJson): unknown {
  return statement.Condition?.['ForAllValues:StringEquals']?.['dynamodb:LeadingKeys'];
}

/** Whether a statement's resources include the table, by its logical ID. */
function referencesTable(statement: PolicyStatementJson, tableId: string): boolean {
  return resourcesOf(statement).some((resource) => JSON.stringify(resource).includes(`"${tableId}"`));
}

function tableAccesses(template: Template, tableId: string): TableAccess[] {
  return allPolicyStatements(template)
    .filter((statement) => referencesTable(statement, tableId))
    .map((statement) => ({ actions: actionsOf(statement).sort(), leadingKeys: leadingKeysOf(statement) }));
}

function kmsStatements(template: Template): PolicyStatementJson[] {
  return allPolicyStatements(template)
    .filter((statement) => actionsOf(statement).some((action) => action.startsWith('kms:')));
}

/** Synthesizes one grant of `method` to a fresh role, with or without a customer key on the table. */
function grantedTemplate(method: GrantMethod, customerKey: boolean): { template: Template; tableId: string } {
  const stack = createStack();
  const table = new AuthKeyStoreTable(stack, 'auth-key-store-table', customerKey ? new kms.Key(stack, 'customer-key') : undefined);

  table[method](newRole(stack, 'grantee'));

  return { template: Template.fromStack(stack), tableId: stack.getLogicalId(defaultCfnResource(table)) };
}

describe('AuthKeyStoreTable', () => {
  it('takes its physical name from the stack name, the position hash and the install id', () => {
    // StackNamedTable falls back to Aws.STACK_NAME, so the table name must not reference the data-stack nameBase.
    const stack = createStack();
    const sut   = new AuthKeyStoreTable(stack, 'auth-key-store');

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: {
        'Fn::Join': ['', [
          { Ref: 'AWS::AccountId' },
          '-',
          { Ref: 'AWS::StackName' },
          `-auth-key-store-${PositionHash.of(sut)}-`,
          stack.resolve(StackIdentity.guidPrefix),
        ]],
      },
    });
  });

  it('defines a pk/sk on-demand table that is deleted together with the stack', () => {
    const stack = createStack();
    new AuthKeyStoreTable(stack, 'auth-key-store-table');

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema:   [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    });
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
  });

  it('adds no SSESpecification without a customer key, so the table keeps its AWS-owned encryption', () => {
    const stack = createStack();
    new AuthKeyStoreTable(stack, 'auth-key-store-table');

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', { SSESpecification: Match.absent() });
  });

  it('encrypts the table with the customer key when one is passed', () => {
    const stack = createStack();
    new AuthKeyStoreTable(stack, 'auth-key-store-table', new kms.Key(stack, 'customer-key'));

    Template.fromStack(stack).hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
    });
  });

  it('limits every access to the table to one LeadingKeys value, granted to the roles the plan names', () => {
    const stack = createStack();
    const table = new AuthKeyStoreTable(stack, 'auth-key-store-table');
    const roles = {
      authorizer: newRole(stack, 'authorizer'),
      edge:       newRole(stack, 'edge-function'),
      jmapApi:    newRole(stack, 'jmap-api'),
      bootstrap:  newRole(stack, 'bootstrap'),
      updater:    newRole(stack, 'auth-key-store-updater'),
      userApi:    newRole(stack, 'user-api'),
      runner:     newRole(stack, 'mail-import-runner'),
    };

    table.grantReadJwks(roles.authorizer);
    table.grantReadJwks(roles.edge);
    table.grantReadHmac(roles.edge);
    table.grantReadHmac(roles.jmapApi);
    table.grantManageHmac(roles.bootstrap);
    table.grantManageHmac(roles.updater);
    table.grantManageJwks(roles.updater);
    table.grantManageImportKeys(roles.updater);
    table.grantReadImportPublicKey(roles.userApi);
    table.grantReadImportPrivateKey(roles.runner);

    const template               = Template.fromStack(stack);
    const tableId                = stack.getLogicalId(defaultCfnResource(table));
    const accesses: RoleAccess[] = Object.entries(roles).flatMap(([role, created]) => statementsForRole(template, stack.getLogicalId(defaultCfnResource(created)))
      .filter((statement) => referencesTable(statement, tableId))
      .map((statement) => ({ role, leadingKeys: leadingKeysOf(statement) })));

    expect(accesses).toEqual([
      { role: 'authorizer',  leadingKeys: ['jwks'] },
      { role: 'edge',        leadingKeys: ['jwks'] },
      { role: 'edge',        leadingKeys: ['hmac'] },
      { role: 'jmapApi',     leadingKeys: ['hmac'] },
      { role: 'bootstrap',   leadingKeys: ['hmac'] },
      { role: 'updater',     leadingKeys: ['hmac'] },
      { role: 'updater',     leadingKeys: ['jwks'] },
      { role: 'updater',     leadingKeys: ['import-key-public'] },
      { role: 'updater',     leadingKeys: ['import-key-private'] },
      { role: 'userApi',     leadingKeys: ['import-key-public'] },
      { role: 'runner',      leadingKeys: ['import-key-private'] },
    ]);
  });

  it.each<[GrantMethod, TableAccess[]]>([
    ['grantReadJwks',             [{ actions: ['dynamodb:GetItem'], leadingKeys: ['jwks'] }]],
    ['grantReadHmac',             [{ actions: ['dynamodb:GetItem'], leadingKeys: ['hmac'] }]],
    ['grantManageHmac',           [{ actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], leadingKeys: ['hmac'] }]],
    ['grantManageJwks',           [{ actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], leadingKeys: ['jwks'] }]],
    ['grantManageImportKeys',     [
      { actions: ['dynamodb:GetItem', 'dynamodb:PutItem'], leadingKeys: ['import-key-public'] },
      { actions: ['dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:Query'], leadingKeys: ['import-key-private'] },
    ]],
    ['grantReadImportPublicKey',  [{ actions: ['dynamodb:GetItem'], leadingKeys: ['import-key-public'] }]],
    ['grantReadImportPrivateKey', [{ actions: ['dynamodb:GetItem'], leadingKeys: ['import-key-private'] }]],
  ])('%s renders exactly its planned table access', (method, expected) => {
    const { template, tableId } = grantedTemplate(method, false);

    expect(tableAccesses(template, tableId)).toEqual(expected);
  });

  it.each(GRANT_METHODS)('%s adds KMS statements exactly when a customer key encrypts the table', (method) => {
    expect(kmsStatements(grantedTemplate(method, true).template)).not.toHaveLength(0);
    expect(kmsStatements(grantedTemplate(method, false).template)).toHaveLength(0);
  });
});
