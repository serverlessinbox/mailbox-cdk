/// <reference types="jest" />

/**
 * Pins the permissions the edge deployer worker holds. CloudFormation creates the edge stack's
 * certificate, Lambda@Edge function and resource group with this role, and the ACM and Lambda grants
 * are scoped by the root-stack tag: a grant that loses its tag condition lets the worker change
 * certificates and functions of other stacks, and one that is too narrow fails the edge deployment.
 */

import { renderWithTokens, sharedWorkerServiceName, statementsForAction, tagKeysOf } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { IArtifactObject, IDeployedStack }                                      from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                                  from 'aws-cdk-lib/assertions';
import { Role }                                                                      from 'aws-cdk-lib/aws-iam';

import {
  TEST_ACCOUNT,
  newDeployerTestStack,
} from '../../../__tests__/deployer-test-helpers';
import { MailboxEdgeDeployerWorkerLambda }           from '../mailbox-edge-deployer-worker-lambda';
import type { MailboxEdgeDeployerWorkerLambdaProps } from '../mailbox-edge-deployer-worker-lambda';

import { ownedByRootStack }                          from './lambda-wrapper-helpers';

const EDGE_REGION                 = 'us-east-1';
const JMAP_BLOB_DOWNLOAD_ROLE_ARN = 'arn:aws:iam::111122223333:role/test-role';
const ROOT_STACK                  = 'test-stack';
const ROOT_STACK_ID               = 'test-guid';

const ownedByResource = ownedByRootStack('ResourceTag', ROOT_STACK, ROOT_STACK_ID);
const ownedByRequest  = ownedByRootStack('RequestTag', ROOT_STACK, ROOT_STACK_ID);

interface EdgeWorkerBuild {
  readonly worker:       MailboxEdgeDeployerWorkerLambda;
  readonly template:     Template;
  readonly edgeStack:    IDeployedStack;
  readonly edgeTemplate: IArtifactObject;
  readonly edgeArtifact: IArtifactObject;
}

function buildWorker(props: Partial<MailboxEdgeDeployerWorkerLambdaProps> = {}): EdgeWorkerBuild {
  const { stack, artifactResolver }   = newDeployerTestStack();
  const edgeStack:    IDeployedStack  = { grantLifecycle: jest.fn(), grantTemplateRead: jest.fn(), grantDescribe: jest.fn() };
  const edgeTemplate: IArtifactObject = { grantRead: jest.fn() };
  const edgeArtifact: IArtifactObject = { grantRead: jest.fn() };
  const worker                        = new MailboxEdgeDeployerWorkerLambda(stack, 'worker', {
    artifactResolver,
    edgeStackNamePattern: 'test-stack-edge-*',
    edgeStack,
    rootStack:            ROOT_STACK,
    rootStackId:          ROOT_STACK_ID,
    template:             edgeTemplate,
    artifactObjects:      [edgeArtifact],
    jmapBlobDownloadRole: Role.fromRoleArn(stack, 'jmap-blob-download-role', JMAP_BLOB_DOWNLOAD_ROLE_ARN),
    ...props,
  });
  return { worker, template: Template.fromStack(stack), edgeStack, edgeTemplate, edgeArtifact };
}

function synthWorker(props: Partial<MailboxEdgeDeployerWorkerLambdaProps> = {}): Template {
  return buildWorker(props).template;
}

function resourceOf(template: Template, action: string, index = 0): string {
  return renderWithTokens(statementsForAction(template, action)[index].Resource);
}

describe('MailboxEdgeDeployerWorkerLambda', () => {
  let template: Template;

  beforeAll(() => {
    template = synthWorker();
  });

  it('runs as the edge deployer worker', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: sharedWorkerServiceName('edge') } },
    });
  });

  it('holds no role authorship: the execution role is created by the root stack', () => {
    for (const action of ['iam:CreateRole', 'iam:PutRolePolicy', 'iam:AttachRolePolicy']) {
      expect(statementsForAction(template, action)).toEqual([]);
    }
  });

  it('manages the edge stack it is given', () => {
    const { worker, edgeStack } = buildWorker();

    expect(edgeStack.grantLifecycle).toHaveBeenCalledWith(worker);
  });

  it('reads the edge template and every Lambda artifact it is given', () => {
    const { worker, edgeTemplate, edgeArtifact } = buildWorker();

    expect(edgeTemplate.grantRead).toHaveBeenCalledWith(worker);
    expect(edgeArtifact.grantRead).toHaveBeenCalledWith(worker);
  });

  it('adds the edge and root-region tag keys to the tagging grant', () => {
    for (const action of ['tag:TagResources', 'tag:UntagResources']) {
      const statements = statementsForAction(template, action);

      expect(statements).toHaveLength(1);
      expect(tagKeysOf(statements[0])).toEqual(
        expect.arrayContaining(['serverless-inbox:edge', 'serverless-inbox:root-region']),
      );
    }
  });

  describe('certificate lifecycle', () => {
    const CERTIFICATE_ARNS = `arn:<token>:acm:${EDGE_REGION}:${TEST_ACCOUNT}:certificate/*`;

    it('requests certificates unconditionally, since CloudFormation creates them untagged', () => {
      const statements = statementsForAction(template, 'acm:RequestCertificate');

      expect(statements).toHaveLength(1);
      expect(statements[0].Condition).toBeUndefined();
      expect(resourceOf(template, 'acm:RequestCertificate')).toBe(CERTIFICATE_ARNS);
    });

    it('adds tags on create when the request carries a root-stack tag, and on update when the certificate already has one', () => {
      const statements = statementsForAction(template, 'acm:AddTagsToCertificate');

      expect(statements.map((statement) => statement.Condition)).toEqual([
        ownedByRequest.byId, ownedByRequest.byName, ownedByResource.byId, ownedByResource.byName,
      ]);
    });

    it('removes tags from and deletes only certificates the root stack owns, by id or by name when untagged with an id', () => {
      for (const action of ['acm:RemoveTagsFromCertificate', 'acm:DeleteCertificate']) {
        const statements = statementsForAction(template, action);

        expect(statements.map((statement) => statement.Condition)).toEqual([ownedByResource.byId, ownedByResource.byName]);
      }
    });
  });

  describe('Lambda function lifecycle', () => {
    it('creates functions by the edge stack name pattern, as an ARN and as a function-name condition', () => {
      const statements = statementsForAction(template, 'lambda:CreateFunction');

      expect(statements).toHaveLength(2);
      expect(resourceOf(template, 'lambda:CreateFunction', 0)).toBe(
        `arn:<token>:lambda:${EDGE_REGION}:${TEST_ACCOUNT}:function:test-stack-edge-*`,
      );
      expect(statements[1].Resource).toBe('*');
      expect(statements[1].Condition).toEqual({ StringLike: { 'lambda:FunctionName': 'test-stack-edge-*' } });
    });

    it('also manages existing edge-region functions the root stack owns and the edge tag marks, which survives name truncation', () => {
      const statements = statementsForAction(template, 'lambda:DeleteFunction');
      const edgeTag    = { 'aws:ResourceTag/serverless-inbox:edge': 'true' };
      const idTag      = 'aws:ResourceTag/serverless-inbox:root-stack-id';
      const nameTag    = 'aws:ResourceTag/serverless-inbox:root-stack';

      expect(statements).toHaveLength(4);
      expect(statements.slice(2).map((statement) => renderWithTokens(statement.Resource))).toEqual([
        `arn:<token>:lambda:${EDGE_REGION}:${TEST_ACCOUNT}:function:*`,
        `arn:<token>:lambda:${EDGE_REGION}:${TEST_ACCOUNT}:function:*`,
      ]);
      expect(statements.slice(2).map((statement) => statement.Condition)).toEqual([
        { StringEquals: { [idTag]: ROOT_STACK_ID, ...edgeTag } },
        { StringEquals: { [nameTag]: ROOT_STACK, ...edgeTag }, Null: { [idTag]: 'true' } },
      ]);
    });

    it('grants no Lambda write action on every resource unless it is limited to the edge function name pattern', () => {
      const writeActions = [
        'lambda:DeleteFunction', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration',
        'lambda:PublishVersion', 'lambda:TagResource', 'lambda:UntagResource',
      ];
      const unrestricted = writeActions.flatMap((action) => statementsForAction(template, action))
        .filter((statement) => statement.Resource === '*')
        .filter((statement) => statement.Condition?.StringLike?.['lambda:FunctionName'] !== 'test-stack-edge-*');

      expect(unrestricted).toEqual([]);
    });
  });

  it('passes only the jmap-blob-download role, and only to the Lambda services', () => {
    const statements = statementsForAction(template, 'iam:PassRole');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toBe(JMAP_BLOB_DOWNLOAD_ROLE_ARN);
    expect(statements[0].Condition).toEqual({
      StringEquals: { 'iam:PassedToService': ['lambda.amazonaws.com', 'edgelambda.amazonaws.com'] },
    });
  });

  describe('resource group lifecycle', () => {
    it('creates groups on every resource, since scoping group creation is unverified', () => {
      expect(statementsForAction(template, 'resource-groups:CreateGroup')[0].Resource).toBe('*');
    });

    it('changes only the groups named after the edge stack name pattern', () => {
      expect(resourceOf(template, 'resource-groups:DeleteGroup')).toBe(
        `arn:<token>:resource-groups:${EDGE_REGION}:${TEST_ACCOUNT}:group/test-stack-edge-*-serverless-inbox`,
      );
    });
  });

  describe('DNS validation', () => {
    it('writes records of the given hosted zone only, and reads change status', () => {
      const withZone = synthWorker({ hostedZoneId: 'Z0TESTZONE' });

      expect(resourceOf(withZone, 'route53:ChangeResourceRecordSets')).toBe('arn:<token>:route53:::hostedzone/Z0TESTZONE');
      expect(resourceOf(withZone, 'route53:GetChange')).toBe('arn:<token>:route53:::change/*');
    });

    it('is not granted without a hosted zone', () => {
      expect(statementsForAction(template, 'route53:ChangeResourceRecordSets')).toEqual([]);
    });
  });
});
