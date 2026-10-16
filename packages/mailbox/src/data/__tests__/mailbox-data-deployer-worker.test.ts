/// <reference types="jest" />

/**
 * Pins the permissions the data deployer worker holds. CloudFormation creates the data stack's tables
 * and bucket with this role, so each grant must reach exactly the resources named from the data stack's
 * name base: a wider one lets the worker manage tables and buckets it does not own, and a missing one
 * fails the data stack deployment.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { MailboxDataDeployerWorker } from '../mailbox-data-deployer-worker';
import { renderWithTokens, sharedWorkerServiceName, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import {
  TEST_ACCOUNT,
  TEST_REGION,
  newDeployerTestStack,
} from '../../__tests__/deployer-test-helpers';

const DATA_STACK_ARN = 'arn:aws:cloudformation:us-west-2:111122223333:stack/test-stack-data/*';
const TEMPLATE_OBJECT_ARN = 'arn:aws:s3:::test-artifacts/templates/data-template.json';

function synthWorker(): Template {
  const { stack, artifactResolver } = newDeployerTestStack();
  new MailboxDataDeployerWorker(stack, 'worker', {
    artifactResolver,
    stack,
    dataStackArn: DATA_STACK_ARN,
    dataStackName: 'test-stack-data',
    templateObjectArn: TEMPLATE_OBJECT_ARN,
    nameBase: 'test-stack-data',
  });
  return Template.fromStack(stack);
}

describe('MailboxDataDeployerWorker', () => {
  let template: Template;

  beforeAll(() => {
    template = synthWorker();
  });

  it('runs as the data deployer worker', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: sharedWorkerServiceName('data') } },
    });
  });

  it('manages only the data stack', () => {
    const statements = statementsForAction(template, 'cloudformation:CreateStack');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toBe(DATA_STACK_ARN);
  });

  it('validates templates, which acts on a template URL rather than a stack', () => {
    expect(statementsForAction(template, 'cloudformation:ValidateTemplate')).toHaveLength(1);
  });

  it('reads only the data stack template object', () => {
    const statements = statementsForAction(template, 's3:GetObject');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toBe(TEMPLATE_OBJECT_ARN);
  });

  it('manages only the tables named from the name base', () => {
    const statements = statementsForAction(template, 'dynamodb:CreateTable');

    expect(statements).toHaveLength(1);
    expect(renderWithTokens(statements[0].Resource)).toBe(
      `arn:aws:dynamodb:${TEST_REGION}:${TEST_ACCOUNT}:table/<token>-test-stack-data-*`,
    );
  });

  it('manages only the buckets named from the name base', () => {
    const statements = statementsForAction(template, 's3:CreateBucket');

    expect(statements).toHaveLength(1);
    expect(renderWithTokens(statements[0].Resource)).toBe(`arn:aws:s3:::${TEST_ACCOUNT}-test-stack-data-*`);
  });

  it('creates KMS grants only for AWS resources, on the DynamoDB and S3 managed keys and account keys', () => {
    const statements = statementsForAction(template, 'kms:CreateGrant');

    expect(statements).toHaveLength(1);
    expect(statements[0].Condition).toEqual({ Bool: { 'kms:GrantIsForAWSResource': 'true' } });
    expect(statements[0].Resource).toEqual([
      `arn:aws:kms:${TEST_REGION}:${TEST_ACCOUNT}:alias/aws/dynamodb`,
      `arn:aws:kms:${TEST_REGION}:${TEST_ACCOUNT}:alias/aws/s3`,
      `arn:aws:kms:${TEST_REGION}:${TEST_ACCOUNT}:key/*`,
    ]);
  });
});
