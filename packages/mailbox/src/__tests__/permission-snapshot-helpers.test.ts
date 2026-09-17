/**
 * Self-tests for `permission-snapshot-helpers.ts` against synthetic, hand-built
 * CloudFormation JSON — proving the normalizer actually discriminates a real permission
 * change from cosmetic churn, rather than passing vacuously. The previous version of this
 * gate never had these: it silently captured zero Lambdas and reported "complete."
 *
 * TEMPORARY: Grant Concept Phase 0 gate (removed in Phase 13).
 */

import { capturePermissionSnapshotFromTemplateJson, compareSnapshots } from './permission-snapshot-helpers';

function lambdaResource(logicalId: string, opts: {
  artifactName: string;
  serviceName: string;
  roleLogicalId: string;
  envVarNames?: string[];
}) {
  const env: Record<string, string> = { SERVICE_NAME: opts.serviceName };
  for (const name of opts.envVarNames ?? []) env[name] = 'placeholder';
  return {
    Type: 'AWS::Lambda::Function',
    Properties: {
      Role: { 'Fn::GetAtt': [opts.roleLogicalId, 'Arn'] },
      Environment: { Variables: env },
      Tags: [{ Key: 'serverless-inbox:artifact-name', Value: opts.artifactName }],
    },
    Metadata: { 'aws:cdk:path': `TestStack/${logicalId}/Resource` },
  };
}

function roleResource(logicalId: string, statements: any[]) {
  return {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      Policies: [{ PolicyName: 'inline', PolicyDocument: { Statement: statements } }],
    },
    Metadata: { 'aws:cdk:path': `TestStack/${logicalId}/Resource` },
  };
}

function tableResource(logicalId: string, tableName: string) {
  return {
    Type: 'AWS::DynamoDB::Table',
    Properties: { TableName: tableName },
    Metadata: { 'aws:cdk:path': `TestStack/${logicalId}/Resource` },
  };
}

function baseTemplate(): { Resources: Record<string, any> } {
  return {
    Resources: {
      Table: tableResource('Table', 'my-table'),
      Role: roleResource('Role', [
        { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { 'Fn::GetAtt': ['Table', 'Arn'] } },
      ]),
      Handler: lambdaResource('Handler', { artifactName: 'my-handler', serviceName: 'my-handler', roleLogicalId: 'Role', envVarNames: ['FOO'] }),
    },
  };
}

describe('permission-snapshot-helpers self-tests', () => {
  it('produces an identical snapshot after renaming a logical ID and all its references', () => {
    const before = baseTemplate();
    const beforeSnapshot = capturePermissionSnapshotFromTemplateJson(before);

    const after = {
      Resources: {
        RenamedTable: tableResource('RenamedTable', 'my-table'),
        Role: roleResource('Role', [
          { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { 'Fn::GetAtt': ['RenamedTable', 'Arn'] } },
        ]),
        Handler: lambdaResource('Handler', { artifactName: 'my-handler', serviceName: 'my-handler', roleLogicalId: 'Role', envVarNames: ['FOO'] }),
      },
    };
    const afterSnapshot = capturePermissionSnapshotFromTemplateJson(after);

    expect(compareSnapshots(afterSnapshot, beforeSnapshot).matches).toBe(true);
  });

  it('detects a new action added to an existing statement', () => {
    const before = baseTemplate();
    const beforeSnapshot = capturePermissionSnapshotFromTemplateJson(before);

    const after = baseTemplate();
    after.Resources.Role = roleResource('Role', [
      { Effect: 'Allow', Action: ['dynamodb:GetItem', 'dynamodb:PutItem'], Resource: { 'Fn::GetAtt': ['Table', 'Arn'] } },
    ]);
    const afterSnapshot = capturePermissionSnapshotFromTemplateJson(after);

    expect(compareSnapshots(afterSnapshot, beforeSnapshot).matches).toBe(false);
  });

  it('detects a statement resource retargeted to a different resource', () => {
    const before = baseTemplate();
    before.Resources.OtherTable = tableResource('OtherTable', 'other-table');
    const beforeSnapshot = capturePermissionSnapshotFromTemplateJson(before);

    const after = baseTemplate();
    after.Resources.OtherTable = tableResource('OtherTable', 'other-table');
    after.Resources.Role = roleResource('Role', [
      { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { 'Fn::GetAtt': ['OtherTable', 'Arn'] } },
    ]);
    const afterSnapshot = capturePermissionSnapshotFromTemplateJson(after);

    expect(compareSnapshots(afterSnapshot, beforeSnapshot).matches).toBe(false);
  });

  it('detects an env var name removed from a function', () => {
    const before = baseTemplate();
    const beforeSnapshot = capturePermissionSnapshotFromTemplateJson(before);

    const after = baseTemplate();
    after.Resources.Handler = lambdaResource('Handler', { artifactName: 'my-handler', serviceName: 'my-handler', roleLogicalId: 'Role' });
    const afterSnapshot = capturePermissionSnapshotFromTemplateJson(after);

    expect(compareSnapshots(afterSnapshot, beforeSnapshot).matches).toBe(false);
  });

  it('detects a function (and its role) being removed entirely', () => {
    const before = baseTemplate();
    const beforeSnapshot = capturePermissionSnapshotFromTemplateJson(before);

    const after = { Resources: { Table: baseTemplate().Resources.Table } };
    const afterSnapshot = capturePermissionSnapshotFromTemplateJson(after);

    expect(compareSnapshots(afterSnapshot, beforeSnapshot).matches).toBe(false);
    expect(Object.keys(afterSnapshot.functions).length).toBe(0);
    expect(Object.keys(afterSnapshot.roles).length).toBe(0);
  });

  it('throws when a function has no artifact-name tag, no SERVICE_NAME env, and no aws:cdk:path fallback', () => {
    const template = {
      Resources: {
        Role: roleResource('Role', []),
        Handler: {
          Type: 'AWS::Lambda::Function',
          Properties: { Role: { 'Fn::GetAtt': ['Role', 'Arn'] }, Environment: { Variables: {} } },
        },
      },
    };

    expect(() => capturePermissionSnapshotFromTemplateJson(template)).toThrow();
  });

  it('throws when two functions collide on the same stable key', () => {
    const template = {
      Resources: {
        RoleA: roleResource('RoleA', []),
        RoleB: roleResource('RoleB', []),
        HandlerA: lambdaResource('HandlerA', { artifactName: 'dup', serviceName: 'dup', roleLogicalId: 'RoleA' }),
        HandlerB: lambdaResource('HandlerB', { artifactName: 'dup', serviceName: 'dup', roleLogicalId: 'RoleB' }),
      },
    };

    expect(() => capturePermissionSnapshotFromTemplateJson(template)).toThrow(/collision/);
  });

  it('throws on a statement referencing a logical ID that does not exist in the template', () => {
    const template = {
      Resources: {
        Role: roleResource('Role', [
          { Effect: 'Allow', Action: 'dynamodb:GetItem', Resource: { 'Fn::GetAtt': ['GhostTable', 'Arn'] } },
        ]),
        Handler: lambdaResource('Handler', { artifactName: 'my-handler', serviceName: 'my-handler', roleLogicalId: 'Role' }),
      },
    };

    expect(() => capturePermissionSnapshotFromTemplateJson(template)).toThrow(/Unresolvable/);
  });
});
