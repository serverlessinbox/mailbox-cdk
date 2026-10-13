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
import { BaseTable } from '../base-table';
import { actionsOf, statementsOfDocument } from '../cdk-test-support';
import type { PolicyStatementJson } from '../cdk-test-support';

/**
 * Normalize resources into an array for consistent checking.
 */
function normalizeResources(resource: unknown): unknown[] {
  if (Array.isArray(resource)) {
    return resource;
  }
  return resource !== undefined ? [resource] : [];
}

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
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, Record<string, unknown>> | undefined;

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

    // Find all inline policies for this role and collect all Deny statements
    let foundCompleteStatement = false;

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') {
        continue;
      }

      // Check if this policy belongs to our role
      const policyDetails = resource.Properties as Record<string, unknown>;
      if (!policyDetails?.Roles || !Array.isArray(policyDetails.Roles)) {
        continue;
      }

      const policyRoles = policyDetails.Roles as unknown[];
      // Check if this policy is attached to our Lambda role
      const attachedToOurRole = policyRoles.some((roleRef: unknown) => {
        if (roleRef === roleName) {
          return true;
        }
        if (typeof roleRef === 'object' && roleRef !== null && 'Ref' in roleRef) {
          const ref = roleRef as Record<string, unknown>;
          return ref.Ref === roleName;
        }
        return false;
      });

      if (!attachedToOurRole) {
        continue;
      }

      const policyDoc = policyDetails.PolicyDocument;
      const statements = statementsOfDocument(policyDoc);

      for (const stmt of statements) {
        if (stmt.Effect !== 'Deny') {
          continue;
        }

        const actions = actionsOf(stmt);

        // Check if this is a scan/partiql deny with all required actions
        if (
          actions.includes('dynamodb:Scan') &&
          actions.includes('dynamodb:PartiQLSelect') &&
          actions.includes('dynamodb:PartiQLInsert') &&
          actions.includes('dynamodb:PartiQLUpdate') &&
          actions.includes('dynamodb:PartiQLDelete')
        ) {
          const stmtResources = normalizeResources(stmt.Resource);

          // Check for table references (either ARNs or CFN references)
          const hasTableRef = stmtResources.some((r: unknown) => {
            if (typeof r === 'string') {
              return r.includes('arn:aws:dynamodb') || r.includes('TestTable');
            }
            if (typeof r === 'object' && r !== null) {
              const ref = r as Record<string, unknown>;
              return 'Fn::GetAtt' in ref || 'Ref' in ref;
            }
            return false;
          });

          // We expect at least 2 resources: table ARN and index ARN
          if (hasTableRef && stmtResources.length >= 2) {
            foundCompleteStatement = true;
            break;
          }
        }
      }

      if (foundCompleteStatement) {
        break;
      }
    }

    if (!foundCompleteStatement) {
      throw new Error(
        'Deny statement with all PartiQL actions not found in Lambda role policy. ' +
          'Expected Deny statement with actions: [dynamodb:Scan, dynamodb:PartiQLSelect, ' +
          'dynamodb:PartiQLInsert, dynamodb:PartiQLUpdate, dynamodb:PartiQLDelete] and ' +
          'resources scoped to the table ARN and its indexes'
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
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, Record<string, unknown>> | undefined;

    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Count Deny statements with PartiQL actions
    let denyCount = 0;
    const deniedResourceArns: unknown[] = [];

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') {
        continue;
      }

      const policyDetails = resource.Properties as Record<string, unknown>;
      const policyDoc = policyDetails.PolicyDocument;
      const statements = statementsOfDocument(policyDoc);

      for (const stmt of statements) {
        if (stmt.Effect === 'Deny') {
          const actions = actionsOf(stmt);
          if (actions.includes('dynamodb:Scan') || actions.includes('dynamodb:PartiQLSelect')) {
            denyCount++;
            const stmtResources = normalizeResources(stmt.Resource);
            deniedResourceArns.push(...stmtResources);
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
    if (deniedResourceArns.length === 0) {
      throw new Error(
        'Expected resource ARNs in Deny statements, but found none. ' +
          'Check that each Deny statement includes resources array.'
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
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, Record<string, unknown>> | undefined;

    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Verify Deny statement exists
    let foundDeny = false;

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') {
        continue;
      }

      const policyDetails = resource.Properties as Record<string, unknown>;
      const policyDoc = policyDetails.PolicyDocument;
      const statements = statementsOfDocument(policyDoc);

      if (statements.some((stmt: PolicyStatementJson) => {
        if (stmt.Effect !== 'Deny') {
          return false;
        }
        const actions = actionsOf(stmt);
        return actions.includes('dynamodb:Scan');
      })) {
        foundDeny = true;
        break;
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
    const templateJson = template.toJSON();
    const resources = templateJson.Resources as Record<string, Record<string, unknown>> | undefined;

    if (!resources) {
      throw new Error('No resources found in template');
    }

    // Verify Allow statements still exist
    let foundAllow = false;

    for (const [, resource] of Object.entries(resources)) {
      if (resource.Type !== 'AWS::IAM::Policy') {
        continue;
      }

      const policyDetails = resource.Properties as Record<string, unknown>;
      const policyDoc = policyDetails.PolicyDocument;
      const statements = statementsOfDocument(policyDoc);

      if (statements.some((stmt: PolicyStatementJson) => {
        if (stmt.Effect !== 'Allow') {
          return false;
        }
        const actions = actionsOf(stmt);
        return (
          actions.includes('dynamodb:GetItem') ||
          actions.includes('dynamodb:Query') ||
          actions.includes('dynamodb:BatchGetItem')
        );
      })) {
        foundAllow = true;
        break;
      }
    }

    if (!foundAllow) {
      throw new Error(
        'Allow statements not preserved: grantReadData should still permit legitimate read operations'
      );
    }
  });
});
