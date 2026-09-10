import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { grantCognitoDataDeployerPermissions } from '../mailbox-cognito-data-deployer-grants';

const ROOT_STACK_TAG_KEY = 'aws:ResourceTag/serverless-inbox:root-stack';
const REQUEST_STACK_TAG_KEY = 'aws:RequestTag/serverless-inbox:root-stack';

function synthGrants(): Template {
  const app = new App();
  const stack = new cdk.Stack(app, 'test-stack', {
    env: { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  const worker = new LambdaFunction(stack, 'worker', {
    runtime: Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });

  grantCognitoDataDeployerPermissions(worker, {
    templateObjectArn: 'arn:aws:s3:::test-bucket/template.yaml',
  });

  return Template.fromStack(stack);
}

/** Flattens every statement across every AWS::IAM::Policy resource in the template. */
function allStatements(template: Template): any[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const statements: any[] = [];
  for (const [, policy] of Object.entries(policies)) {
    const doc = (policy as any).Properties?.PolicyDocument;
    for (const stmt of doc?.Statement ?? []) {
      statements.push(stmt);
    }
  }
  return statements;
}

function statementsForAction(template: Template, action: string): any[] {
  return allStatements(template).filter((stmt) => {
    const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
    return actions.includes(action);
  });
}

describe('grantCognitoDataDeployerPermissions', () => {
  let template: Template;

  beforeAll(() => {
    template = synthGrants();
  });

  it('grants CreateUserPool unconditionally (no resource type to tag-gate on)', () => {
    const stmts = statementsForAction(template, 'cognito-idp:CreateUserPool');
    expect(stmts.length).toBe(1);
    expect(stmts[0].Condition).toBeUndefined();
  });

  it('gates the user-pool lifecycle actions by aws:ResourceTag/serverless-inbox:root-stack', () => {
    const lifecycleActions = [
      'cognito-idp:DeleteUserPool',
      'cognito-idp:DescribeUserPool',
      'cognito-idp:UpdateUserPool',
      'cognito-idp:SetUserPoolMfaConfig',
      'cognito-idp:GetUserPoolMfaConfig',
      'cognito-idp:UntagResource',
      'cognito-idp:ListTagsForResource',
    ];

    for (const action of lifecycleActions) {
      const stmts = statementsForAction(template, action);
      expect(stmts.length).toBe(1);
      const condition = stmts[0].Condition;
      expect(condition?.StringEquals?.[ROOT_STACK_TAG_KEY]).toBeDefined();
    }
  });

  it('splits TagResource into a RequestTag-gated (create) and ResourceTag-gated (update) statement', () => {
    const stmts = statementsForAction(template, 'cognito-idp:TagResource');
    expect(stmts.length).toBe(2);

    const requestGated = stmts.find((s) => s.Condition?.StringEquals?.[REQUEST_STACK_TAG_KEY] !== undefined);
    const resourceGated = stmts.find((s) => s.Condition?.StringEquals?.[ROOT_STACK_TAG_KEY] !== undefined);

    expect(requestGated).toBeDefined();
    expect(resourceGated).toBeDefined();
    expect(requestGated).not.toBe(resourceGated);
  });

  it('constrains both TagResource statements with ForAllValues:StringEquals on aws:TagKeys (never plain StringEquals)', () => {
    const stmts = statementsForAction(template, 'cognito-idp:TagResource');
    expect(stmts.length).toBe(2);

    for (const stmt of stmts) {
      const tagKeys = stmt.Condition?.['ForAllValues:StringEquals']?.['aws:TagKeys'];
      expect(Array.isArray(tagKeys)).toBe(true);
      expect(tagKeys).toEqual(
        expect.arrayContaining([
          'serverless-inbox:product',
          'serverless-inbox:root-stack',
          'serverless-inbox:stack',
          'serverless-inbox:component',
          'serverless-inbox:version',
          'serverless-inbox:deployer_type',
        ]),
      );
      expect(tagKeys.length).toBe(6);

      // aws:TagKeys is multivalued; a plain StringEquals never matches it and silently denies
      // every tag write. ForAllValues:StringEquals is the only correct operator here.
      expect(stmt.Condition?.StringEquals?.['aws:TagKeys']).toBeUndefined();
    }
  });

  it('gates domain/resource-server/group sub-resource actions by aws:ResourceTag (act on the already-tagged pool)', () => {
    const tagGatedActions = [
      'cognito-idp:CreateUserPoolDomain',
      'cognito-idp:DeleteUserPoolDomain',
      'cognito-idp:UpdateUserPoolDomain',
      'cognito-idp:CreateResourceServer',
      'cognito-idp:DeleteResourceServer',
      'cognito-idp:DescribeResourceServer',
      'cognito-idp:UpdateResourceServer',
      'cognito-idp:CreateGroup',
      'cognito-idp:DeleteGroup',
      'cognito-idp:GetGroup',
      'cognito-idp:UpdateGroup',
    ];

    for (const action of tagGatedActions) {
      const stmts = statementsForAction(template, action);
      expect(stmts.length).toBe(1);
      expect(stmts[0].Condition?.StringEquals?.[ROOT_STACK_TAG_KEY]).toBeDefined();
    }
  });

  it('leaves DescribeUserPoolDomain unconditioned (Service Reference: no resource type binding)', () => {
    const stmts = statementsForAction(template, 'cognito-idp:DescribeUserPoolDomain');
    expect(stmts.length).toBe(1);
    expect(stmts[0].Condition).toBeUndefined();
  });

  it('does not grant any cognito-idp action unconditionally on "*" other than the two undbindable actions', () => {
    // Every cognito-idp action in this file binds to the "userpool" resource type except
    // CreateUserPool and DescribeUserPoolDomain (confirmed against the Service Reference — see
    // the grants file's inline comments). Any other unconditioned cognito-idp statement here is
    // a scoping regression.
    const unconditionedCognitoActions = allStatements(template)
      .filter((stmt) => stmt.Condition === undefined)
      .flatMap((stmt) => (Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action]))
      .filter((action: string) => typeof action === 'string' && action.startsWith('cognito-idp:'));

    expect(new Set(unconditionedCognitoActions)).toEqual(
      new Set(['cognito-idp:CreateUserPool', 'cognito-idp:DescribeUserPoolDomain']),
    );
  });
});
