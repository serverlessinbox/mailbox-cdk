/// <reference types="jest" />

/**
 * Pins the permissions the cognito data deployer worker holds. CloudFormation creates the user pool and
 * its domain, resource server and groups with this role, and every pool action except the two that bind
 * to no resource type is gated by the root-stack tags (id, or name for a resource without an id tag): a lost condition lets the worker change other
 * stacks' pools, and a plain StringEquals on the multivalued aws:TagKeys silently denies every tag write.
 */

import { actionsOf, allPolicyStatements, sharedSubStackTagKeys, sharedWorkerServiceName, statementsForAction, tagKeysOf } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson }                                                                                       from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { IArtifactObject, IDeployedStack }                                                                           from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                                                                       from 'aws-cdk-lib/assertions';

import { newDeployerTestStack }                                                                                           from '../../../data-stack/__tests__/cognito-deployer-helpers';
import { MailboxCognitoDataDeployerWorkerLambda }                                                                         from '../mailbox-cognito-data-deployer-worker-lambda';

const ROOT_STACK                    = { name: 'given-root-stack', id: 'given-root-guid' };
const deployedStack: IDeployedStack = { grantLifecycle: jest.fn(), grantTemplateRead: jest.fn(), grantDescribe: jest.fn() };
const dataTemplate: IArtifactObject = { grantRead: jest.fn() };

/** The tag source of a root-stack statement: 'id' when it matches the stack's guid, 'name' when it matches the name of a resource without an id tag. */
function tagSourceOf(statement: PolicyStatementJson, tagSource: 'ResourceTag' | 'RequestTag'): 'id' | 'name' | undefined {
  const idKey   = `aws:${tagSource}/serverless-inbox:root-stack-id`;
  const nameKey = `aws:${tagSource}/serverless-inbox:root-stack`;
  if (statement.Condition?.StringEquals?.[idKey] !== undefined) {
    return 'id';
  }
  if (statement.Condition?.StringEquals?.[nameKey] !== undefined && statement.Condition?.Null?.[idKey] === 'true') {
    return 'name';
  }
  return undefined;
}

function tagSourcesOf(statements: PolicyStatementJson[], tagSource: 'ResourceTag' | 'RequestTag'): Array<'id' | 'name' | undefined> {
  return statements.map((statement) => tagSourceOf(statement, tagSource));
}

function synthWorker(): { readonly worker: MailboxCognitoDataDeployerWorkerLambda; readonly template: Template } {
  const { stack, artifactResolver } = newDeployerTestStack();
  const worker                      = new MailboxCognitoDataDeployerWorkerLambda(stack, 'worker', {
    artifactResolver,
    template:      dataTemplate,
    deployedStack,
    rootStack:     ROOT_STACK,
  });
  return { worker, template: Template.fromStack(stack) };
}

describe('MailboxCognitoDataDeployerWorkerLambda', () => {
  let template: Template;
  let worker: MailboxCognitoDataDeployerWorkerLambda;

  beforeAll(() => {
    ({ template, worker } = synthWorker());
  });

  it('runs as the cognito deployer worker', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: sharedWorkerServiceName('cognito') } },
    });
  });

  describe('stack and template', () => {
    it('manages the cognito data stack it is given, and may read its deployed template', () => {
      expect(deployedStack.grantLifecycle).toHaveBeenCalledWith(worker);
      expect(deployedStack.grantTemplateRead).toHaveBeenCalledWith(worker);
    });

    it('validates templates, which acts on a template URL rather than a stack', () => {
      expect(statementsForAction(template, 'cloudformation:ValidateTemplate')).toHaveLength(1);
    });

    it('reads the cognito data stack template object it is given', () => {
      expect(dataTemplate.grantRead).toHaveBeenCalledWith(worker);
    });
  });

  describe('user pool', () => {
    it('grants CreateUserPool unconditionally (no resource type to tag-gate on)', () => {
      const stmts = statementsForAction(template, 'cognito-idp:CreateUserPool');
      expect(stmts.length).toBe(1);
      expect(stmts[0].Condition).toBeUndefined();
    });

    it('gates the user-pool lifecycle actions by the root-stack tags: one statement by id, one by name for a pool without an id tag', () => {
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
        expect(tagSourcesOf(stmts, 'ResourceTag')).toEqual(['id', 'name']);
      }
    });

    it('admits only the pools of the root stack it is given, by id and by name', () => {
      const [byId, byName] = statementsForAction(template, 'cognito-idp:DeleteUserPool');

      expect(byId.Condition?.StringEquals).toEqual({ 'aws:ResourceTag/serverless-inbox:root-stack-id': ROOT_STACK.id });
      expect(byName.Condition?.StringEquals).toEqual({ 'aws:ResourceTag/serverless-inbox:root-stack': ROOT_STACK.name });
    });

    it('splits TagResource into RequestTag-gated (create) and ResourceTag-gated (update) statements, each by id and by name', () => {
      const stmts = statementsForAction(template, 'cognito-idp:TagResource');

      expect(tagSourcesOf(stmts.slice(0, 2), 'RequestTag')).toEqual(['id', 'name']);
      expect(tagSourcesOf(stmts.slice(2), 'ResourceTag')).toEqual(['id', 'name']);
    });

    it('constrains every TagResource statement with ForAllValues:StringLike on aws:TagKeys (never plain StringEquals)', () => {
      const stmts = statementsForAction(template, 'cognito-idp:TagResource');
      expect(stmts.length).toBe(4);

      for (const stmt of stmts) {
        expect(tagKeysOf(stmt)).toEqual(sharedSubStackTagKeys());
        expect(stmt.Condition?.StringEquals?.['aws:TagKeys']).toBeUndefined();
      }
    });

    it('gates domain/resource-server/group sub-resource actions by the root-stack tags (act on the already-tagged pool)', () => {
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
        expect(tagSourcesOf(stmts, 'ResourceTag')).toEqual(['id', 'name']);
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
