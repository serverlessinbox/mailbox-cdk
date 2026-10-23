/// <reference types="jest" />

/**
 * Pins the permissions the data deployer worker holds. CloudFormation creates the data stack's tables
 * and bucket with this role, so each grant must reach exactly the resources named from the data stack's
 * name base: a wider one lets the worker manage tables and buckets it does not own, and a missing one
 * fails the data stack deployment.
 */

import { resourcesOf, sharedWorkerServiceName, statementsForAction } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { IArtifactObject, IDeployedStack }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                                  from 'aws-cdk-lib/assertions';

import { newDeployerTestStack }                                      from '../../../__tests__/deployer-test-helpers';
import { MailboxDataDeployerWorkerLambda }                           from '../mailbox-data-deployer-worker-lambda';

const ACCOUNT_REF   = { Ref: 'AWS::AccountId' };
const REGION_REF    = { Ref: 'AWS::Region' };
const PARTITION_REF = { Ref: 'AWS::Partition' };

interface DataWorkerBuild {
  readonly worker:       MailboxDataDeployerWorkerLambda;
  readonly template:     Template;
  readonly dataStack:    IDeployedStack;
  readonly dataTemplate: IArtifactObject;
}

function synthWorker(): DataWorkerBuild {
  const { stack, artifactResolver }   = newDeployerTestStack();
  const dataStack:    IDeployedStack  = { grantLifecycle: jest.fn(), grantTemplateRead: jest.fn(), grantDescribe: jest.fn() };
  const dataTemplate: IArtifactObject = { grantRead: jest.fn() };
  const worker                        = new MailboxDataDeployerWorkerLambda(stack, 'worker', {
    artifactResolver,
    dataStack,
    dataStackName: 'test-stack-data',
    template:      dataTemplate,
    nameBase:      'test-stack-data',
  });
  return { worker, template: Template.fromStack(stack), dataStack, dataTemplate };
}

describe('MailboxDataDeployerWorkerLambda', () => {
  let template: Template;
  let worker: MailboxDataDeployerWorkerLambda;
  let dataStack: IDeployedStack;
  let dataTemplate: IArtifactObject;

  beforeAll(() => {
    ({ template, worker, dataStack, dataTemplate } = synthWorker());
  });

  it('runs as the data deployer worker', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { SERVICE_NAME: sharedWorkerServiceName('data') } },
    });
  });

  it('manages the data stack it is given', () => {
    expect(dataStack.grantLifecycle).toHaveBeenCalledWith(worker);
  });

  it('validates templates, which acts on a template URL rather than a stack', () => {
    expect(statementsForAction(template, 'cloudformation:ValidateTemplate')).toHaveLength(1);
  });

  it('reads the data stack template object it is given', () => {
    expect(dataTemplate.grantRead).toHaveBeenCalledWith(worker);
  });

  it('manages only the tables named from the name base, in the region and account the stack deploys to', () => {
    const statements = statementsForAction(template, 'dynamodb:CreateTable');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toEqual({
      'Fn::Join': ['', ['arn:', PARTITION_REF, ':dynamodb:', REGION_REF, ':', ACCOUNT_REF, ':table/', ACCOUNT_REF, '-test-stack-data-*']],
    });
  });

  it('manages only the buckets named from the name base, in the account the stack deploys to', () => {
    const statements = statementsForAction(template, 's3:CreateBucket');

    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toEqual({
      'Fn::Join': ['', ['arn:', PARTITION_REF, ':s3:::', ACCOUNT_REF, '-test-stack-data-*']],
    });
  });

  it('scopes every DynamoDB and S3 table and bucket write to the name pattern, never a bare "*"', () => {
    for (const action of ['dynamodb:CreateTable', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable', 's3:CreateBucket', 's3:DeleteBucket', 's3:PutBucketPolicy']) {
      const statements = statementsForAction(template, action);

      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(resourcesOf(statement)).not.toContain('*');
      }
    }
  });

  it('creates KMS grants only for AWS resources, on the DynamoDB and S3 managed keys and account keys', () => {
    const statements = statementsForAction(template, 'kms:CreateGrant');
    const kmsArn     = (resource: string): unknown => ({ 'Fn::Join': ['', ['arn:', PARTITION_REF, ':kms:', REGION_REF, ':', ACCOUNT_REF, `:${resource}`]] });

    expect(statements).toHaveLength(1);
    expect(statements[0].Condition).toEqual({ Bool: { 'kms:GrantIsForAWSResource': 'true' } });
    expect(statements[0].Resource).toEqual([kmsArn('alias/aws/dynamodb'), kmsArn('alias/aws/s3'), kmsArn('key/*')]);
  });
});
