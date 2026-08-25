/**
 * BaseTable Deny Statement Tests
 *
 * Verifies that BaseTable applies deny statements blocking DynamoDB table enumeration
 * (Scan and all PartiQL actions) to any principal granted access to the table.
 *
 * Tests the synthesized CloudFormation template to confirm the Deny statements
 * are correctly embedded in IAM policies, not just constructed in memory.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseTable } from '../utils/base-table';
import {
  CloudFormationResource,
  getPolicyStatements,
  CloudFormationPolicyStatement,
} from './iam-test-helpers';

describe('BaseTable Deny Enumeration', () => {
  it('synthesizes Deny statement for Scan and all PartiQL actions in Lambda role granted grantReadData', () => {
    const app = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create a test table
    const table = new BaseTable(stack, 'TestTable', {
      partitionKey: { name: 'pk', type: cdk.aws_dynamodb.AttributeType.STRING },
    });

    // Create a Lambda function and grant it read access
    const fn = new lambda.Function(stack, 'TestLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    table.grantReadData(fn);

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Find the Lambda execution role
    let roleResource: CloudFormationResource | undefined;
    let roleName: string | undefined;
    for (const [name, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::IAM::Role' && name.includes('TestLambdaServiceRole')) {
        roleResource = resource;
        roleName = name;
        break;
      }
    }

    if (!roleResource) {
      throw new Error('Lambda execution role not found in template');
    }

    // Find all inline policies for this role and collect all Deny statements
    let foundCompleteStatement = false;
    let foundPartialDeny = false;

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') continue;

      // Check if this policy belongs to our role
      const policyDetails = resource.Properties as any;
      if (!policyDetails?.Roles || !Array.isArray(policyDetails.Roles)) continue;

      const policyRoles = policyDetails.Roles as string[];
      // Check if this policy is attached to our Lambda role (by ref or logical ID)
      const attachedToOurRole = policyRoles.some(
        (roleRef: string) =>
          roleRef === roleName ||
          (typeof roleRef === 'object' && (roleRef as any).Ref === roleName)
      );

      if (!attachedToOurRole) continue;

      const policyDoc = resource.Properties?.PolicyDocument as unknown;
      const statements = getPolicyStatements(policyDoc);

      for (const stmt of statements) {
        const cfnStmt = stmt as CloudFormationPolicyStatement;
        if (cfnStmt.Effect !== 'Deny') continue;

        const actions = Array.isArray(cfnStmt.Action)
          ? cfnStmt.Action
          : typeof cfnStmt.Action === 'string'
            ? [cfnStmt.Action]
            : [];

        // Check if this is a scan/partiql deny
        if (
          actions.some((a) => a.includes('dynamodb:Scan') || a.includes('dynamodb:PartiQL'))
        ) {
          foundPartialDeny = true;

          // Check if it has all required actions
          if (
            actions.includes('dynamodb:Scan') &&
            actions.includes('dynamodb:PartiQLSelect') &&
            actions.includes('dynamodb:PartiQLInsert') &&
            actions.includes('dynamodb:PartiQLUpdate') &&
            actions.includes('dynamodb:PartiQLDelete')
          ) {
            const stmtResources = Array.isArray(cfnStmt.Resource)
              ? cfnStmt.Resource
              : typeof cfnStmt.Resource === 'string'
                ? [cfnStmt.Resource]
                : [];
            // Resources can be strings or CloudFormation tokens/references
            // Check for either actual ARNs or Fn::GetAtt patterns
            const hasTableRef = stmtResources.some(
              (r: unknown) =>
                (typeof r === 'string' && (r.includes('arn:aws:dynamodb') || r.includes('TestTable'))) ||
                (typeof r === 'object' && r !== null && ('Fn::GetAtt' in r || 'Ref' in r))
            );
            if (hasTableRef && stmtResources.length >= 2) {
              // We expect at least 2 resources: table ARN and index ARN
              foundCompleteStatement = true;
              break;
            }
          }
        }
      }

      if (foundCompleteStatement) break;
    }

    if (!foundCompleteStatement) {
      throw new Error(
        `Deny statement with all PartiQL actions not found in Lambda role policy. ` +
          `Found partial deny: ${foundPartialDeny}. ` +
          `Expected Deny statement with actions: [dynamodb:Scan, dynamodb:PartiQLSelect, ` +
          `dynamodb:PartiQLInsert, dynamodb:PartiQLUpdate, dynamodb:PartiQLDelete] and ` +
          `resources scoped to the table ARN and its indexes`
      );
    }
  });

  it('applies one Deny statement per table when a role is granted on multiple tables', () => {
    const app = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create multiple tables
    const table1 = new BaseTable(stack, 'TestTable1', {
      partitionKey: { name: 'pk', type: cdk.aws_dynamodb.AttributeType.STRING },
    });

    const table2 = new BaseTable(stack, 'TestTable2', {
      partitionKey: { name: 'pk', type: cdk.aws_dynamodb.AttributeType.STRING },
    });

    // Create a Lambda function and grant it access to both tables
    const fn = new lambda.Function(stack, 'TestLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    table1.grantReadData(fn);
    table2.grantReadData(fn);

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Find the Lambda execution role
    let roleName: string | undefined;
    for (const [name, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::IAM::Role' && name.includes('TestLambdaServiceRole')) {
        roleName = name;
        break;
      }
    }

    if (!roleName) {
      throw new Error('Lambda execution role not found in template');
    }

    // Count Deny statements in the role's policy and track their resource scopes
    let denyCount = 0;
    const deniedResourceArns: unknown[] = [];
    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::IAM::Policy') {
        const policyDoc = resource.Properties?.PolicyDocument as unknown;
        const statements = getPolicyStatements(policyDoc);

        // Count Deny statements with PartiQL actions and collect their resource ARNs
        for (const stmt of statements) {
          const cfnStmt = stmt as CloudFormationPolicyStatement;
          if (cfnStmt.Effect === 'Deny') {
            const actions = Array.isArray(cfnStmt.Action) ? cfnStmt.Action : [cfnStmt.Action];
            if (actions.includes('dynamodb:Scan') || actions.includes('dynamodb:PartiQLSelect')) {
              denyCount++;
              const stmtResources = Array.isArray(cfnStmt.Resource)
                ? cfnStmt.Resource
                : typeof cfnStmt.Resource === 'string'
                  ? [cfnStmt.Resource]
                  : [];
              deniedResourceArns.push(...stmtResources);
            }
          }
        }
      }
    }

    if (denyCount !== 2) {
      throw new Error(
        `Expected exactly 2 Deny statements (one per table), but found ${denyCount}. ` +
          'Each table should contribute its own Deny scoped to that table and its indexes.'
      );
    }

    // Verify that we collected resources from both Deny statements
    // The resources may be CloudFormation tokens or references, so just verify we have content
    if (deniedResourceArns.length === 0) {
      throw new Error(
        `Expected resource ARNs in Deny statements, but found none. ` +
          `Check that each Deny statement includes resources array.`
      );
    }
  });

  it('synthesizes Deny statement for grantFullAccess', () => {
    const app = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const table = new BaseTable(stack, 'TestTable', {
      partitionKey: { name: 'pk', type: cdk.aws_dynamodb.AttributeType.STRING },
    });

    const fn = new lambda.Function(stack, 'TestLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    table.grantFullAccess(fn);

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Verify Deny statement exists
    let foundDeny = false;
    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::IAM::Policy') {
        const policyDoc = resource.Properties?.PolicyDocument as unknown;
        const statements = getPolicyStatements(policyDoc);

        if (
          statements.some((stmt: CloudFormationPolicyStatement) => {
            if (stmt.Effect !== 'Deny') return false;
            const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
            return actions.includes('dynamodb:Scan');
          })
        ) {
          foundDeny = true;
          break;
        }
      }
    }

    if (!foundDeny) {
      throw new Error('Deny statement not found for grantFullAccess');
    }
  });

  it('preserves existing Allow grants when applying Deny', () => {
    const app = new App();
    const stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const table = new BaseTable(stack, 'TestTable', {
      partitionKey: { name: 'pk', type: cdk.aws_dynamodb.AttributeType.STRING },
    });

    const fn = new lambda.Function(stack, 'TestLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
    });

    table.grantReadData(fn);

    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Verify Allow statements still exist
    let foundAllow = false;
    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type === 'AWS::IAM::Policy') {
        const policyDoc = resource.Properties?.PolicyDocument as unknown;
        const statements = getPolicyStatements(policyDoc);

        if (
          statements.some((stmt: CloudFormationPolicyStatement) => {
            if (stmt.Effect !== 'Allow') return false;
            const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
            return (
              actions.includes('dynamodb:GetItem') ||
              actions.includes('dynamodb:Query') ||
              actions.includes('dynamodb:BatchGetItem')
            );
          })
        ) {
          foundAllow = true;
          break;
        }
      }
    }

    if (!foundAllow) {
      throw new Error(
        'Allow statements not preserved: grantReadData should still permit legitimate read operations'
      );
    }
  });
});
