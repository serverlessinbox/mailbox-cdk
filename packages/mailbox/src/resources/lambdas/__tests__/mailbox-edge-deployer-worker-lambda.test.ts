/// <reference types="jest" />

/**
 * Pins the permissions the edge deployer worker holds. CloudFormation creates the edge stack's
 * certificate, Lambda@Edge function and resource group with this role, and the ACM and Lambda grants
 * are scoped by the root-stack tag: a grant that loses its tag condition lets the worker change
 * certificates and functions of other stacks, and one that is too narrow fails the edge deployment.
 */

import { renderWithTokens, sharedWorkerServiceName, statementsForAction, tagKeysOf } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                                                  from 'aws-cdk-lib/assertions';

import {
  TEST_ACCOUNT,
  newDeployerTestStack,
} from '../../../__tests__/deployer-test-helpers';
import { MailboxEdgeDeployerWorkerLambda }           from '../mailbox-edge-deployer-worker-lambda';
import type { MailboxEdgeDeployerWorkerLambdaProps } from '../mailbox-edge-deployer-worker-lambda';

const EDGE_REGION                 = 'us-east-1';
const EDGE_STACK_ARN              = 'arn:aws:cloudformation:us-east-1:111122223333:stack/test-stack-edge*/*';
const TEMPLATE_OBJECT_ARN         = 'arn:aws:s3:::test-artifacts/templates/edge-template.json';
const ARTIFACT_OBJECT_ARN         = 'arn:aws:s3:::test-artifacts-us-east-1/lambdas/jmap-blob-download.zip';
const JMAP_BLOB_DOWNLOAD_ROLE_ARN = 'arn:aws:iam::111122223333:role/test-role';
const ROOT_STACK_TAG              = 'serverless-inbox:root-stack';
const ROOT_STACK_ID_TAG           = 'serverless-inbox:root-stack-id';

/** The two statements that admit an owned resource: tagged with the id, or without an id tag and tagged with the name. */
function ownedByResourceTag(): unknown[] {
  return [
    { StringEquals: { [`aws:ResourceTag/${ROOT_STACK_ID_TAG}`]: 'test-guid' } },
    { StringEquals: { [`aws:ResourceTag/${ROOT_STACK_TAG}`]: 'test-stack' }, Null: { [`aws:ResourceTag/${ROOT_STACK_ID_TAG}`]: 'true' } },
  ];
}

function ownedByRequestTag(): unknown[] {
  return [
    { StringEquals: { [`aws:RequestTag/${ROOT_STACK_ID_TAG}`]: 'test-guid' } },
    { StringEquals: { [`aws:RequestTag/${ROOT_STACK_TAG}`]: 'test-stack' }, Null: { [`aws:RequestTag/${ROOT_STACK_ID_TAG}`]: 'true' } },
  ];
}

function synthWorker(props: Partial<MailboxEdgeDeployerWorkerLambdaProps> = {}): Template {
  const { stack, artifactResolver } = newDeployerTestStack();
  new MailboxEdgeDeployerWorkerLambda(stack, 'worker', {
    artifactResolver,
    stack,
    edgeStackNamePattern: 'test-stack-edge*',
    edgeStackArn: EDGE_STACK_ARN,
    rootStack: 'test-stack',
    rootStackId: 'test-guid',
    templateObjectArn: TEMPLATE_OBJECT_ARN,
    artifactObjectArns: [ARTIFACT_OBJECT_ARN],
    jmapBlobDownloadRoleArn: JMAP_BLOB_DOWNLOAD_ROLE_ARN,
    ...props,
  });
  return Template.fromStack(stack);
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

  it('manages only the edge stack', () => {
    const statements = statementsForAction(template, 'cloudformation:CreateStack');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toBe(EDGE_STACK_ARN);
  });

  it('reads the edge template and every Lambda artifact it references', () => {
    const statements = statementsForAction(template, 's3:GetObject');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toEqual([TEMPLATE_OBJECT_ARN, ARTIFACT_OBJECT_ARN]);
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

      expect(statements.map((statement) => statement.Condition)).toEqual([...ownedByRequestTag(), ...ownedByResourceTag()]);
    });

    it('removes tags from and deletes only certificates the root stack owns, by id or by name when untagged with an id', () => {
      for (const action of ['acm:RemoveTagsFromCertificate', 'acm:DeleteCertificate']) {
        const statements = statementsForAction(template, action);

        expect(statements.map((statement) => statement.Condition)).toEqual(ownedByResourceTag());
      }
    });
  });

  describe('Lambda function lifecycle', () => {
    it('creates functions by the edge stack name pattern, as an ARN and as a function-name condition', () => {
      const statements = statementsForAction(template, 'lambda:CreateFunction');

      expect(statements).toHaveLength(2);
      expect(resourceOf(template, 'lambda:CreateFunction', 0)).toBe(
        `arn:<token>:lambda:${EDGE_REGION}:${TEST_ACCOUNT}:function:test-stack-edge*`,
      );
      expect(statements[1].Resource).toBe('*');
      expect(statements[1].Condition).toEqual({ StringLike: { 'lambda:FunctionName': 'test-stack-edge*' } });
    });

    it('also manages existing functions the root stack owns, which survives name truncation', () => {
      const statements = statementsForAction(template, 'lambda:DeleteFunction');

      expect(statements).toHaveLength(4);
      expect(statements.slice(2).map((statement) => statement.Resource)).toEqual(['*', '*']);
      expect(statements.slice(2).map((statement) => statement.Condition)).toEqual(ownedByResourceTag());
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
        `arn:<token>:resource-groups:${EDGE_REGION}:${TEST_ACCOUNT}:group/test-stack-edge*-serverless-inbox`,
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
