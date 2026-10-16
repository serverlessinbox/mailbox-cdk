/// <reference types="jest" />

/**
 * Pins the permissions the cognito data deployer worker holds. CloudFormation creates the user pool and
 * its domain, resource server and groups with this role, and every pool action except the two that bind
 * to no resource type is gated by the root-stack tag: a lost condition lets the worker change other
 * stacks' pools, and a plain StringEquals on the multivalued aws:TagKeys silently denies every tag write.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { actionsOf, allPolicyStatements, renderWithTokens, sharedSubStackTagKeys, sharedWorkerServiceName, statementsForAction, tagKeysOf } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { MailboxCognitoDataDeployerWorker } from '../mailbox-cognito-data-deployer-worker';
import { newDeployerTestStack } from './cognito-deployer-helpers';

const ROOT_STACK_TAG_KEY = 'aws:ResourceTag/serverless-inbox:root-stack';
const REQUEST_STACK_TAG_KEY = 'aws:RequestTag/serverless-inbox:root-stack';
const TEMPLATE_OBJECT_ARN = 'arn:aws:s3:::test-bucket/template.yaml';

function synthWorker(): Template {
  const { stack, artifactResolver } = newDeployerTestStack();
  new MailboxCognitoDataDeployerWorker(stack, 'worker', {
    artifactResolver,
    templateObjectArn: TEMPLATE_OBJECT_ARN,
  });
  return Template.fromStack(stack);
}

describe('MailboxCognitoDataDeployerWorker', () => {
  let template: Template;

  beforeAll(() => {
    template = synthWorker();
  });

  it('runs as the cognito deployer worker', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: sharedWorkerServiceName('cognito') } },
    });
  });

  describe('stack and template', () => {
    it('manages only the cognito data stack, and may read its deployed template', () => {
      const statements = statementsForAction(template, 'cloudformation:CreateStack');

      expect(statements).toHaveLength(1);
      expect(statements[0].Action).toContain('cloudformation:GetTemplate');
      expect(renderWithTokens(statements[0].Resource)).toBe(
        'arn:aws:cloudformation:<token>:<token>:stack/<token>-cognito/*',
      );
    });

    it('validates templates, which acts on a template URL rather than a stack', () => {
      expect(statementsForAction(template, 'cloudformation:ValidateTemplate')).toHaveLength(1);
    });

    it('reads only the cognito data stack template object', () => {
      const statements = statementsForAction(template, 's3:GetObject');

      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toBe(TEMPLATE_OBJECT_ARN);
    });
  });

  describe('user pool', () => {
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
        expect(stmts[0].Condition?.StringEquals?.[ROOT_STACK_TAG_KEY]).toBeDefined();
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
        expect(tagKeysOf(stmt)).toEqual(sharedSubStackTagKeys());
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

    it('does not grant any cognito-idp action unconditionally other than the two unbindable actions', () => {
      const unconditionedCognitoActions = allPolicyStatements(template)
        .filter((stmt) => stmt.Condition === undefined)
        .flatMap(actionsOf)
        .filter((action) => action.startsWith('cognito-idp:'));

      expect(new Set(unconditionedCognitoActions)).toEqual(
        new Set(['cognito-idp:CreateUserPool', 'cognito-idp:DescribeUserPoolDomain']),
      );
    });
  });
});
