import { Aws, Stack } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { TypeScriptLambda } from '../utils/ts-lambda';

export interface DataDeployerGrantProps {
  stack: Stack;
  dataStackArn: string;
  dataStackName: string;
  templateObjectArn: string;
}

export function grantDataDeployerWorkerPermissions(
  worker: TypeScriptLambda,
  props: DataDeployerGrantProps,
): void {
  // CloudFormation management of the data stack
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplateSummary',
        'cloudformation:GetStackPolicy',
        'cloudformation:SetStackPolicy',
      ],
      resources: [props.dataStackArn],
    })
  );

  // ValidateTemplate acts on S3 URLs, not stack ARNs — must be on *
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['cloudformation:ValidateTemplate'],
      resources: ['*'],
    })
  );

  // Read the data stack template from the artifact bucket (regional bucket)
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [props.templateObjectArn],
    })
  );

  // CloudFormation creates DynamoDB tables using the caller's role (no RoleArn passed)
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'dynamodb:CreateTable',
        'dynamodb:DeleteTable',
        'dynamodb:DescribeTable',
        'dynamodb:UpdateTable',
        'dynamodb:UpdateContinuousBackups',
        'dynamodb:DescribeContinuousBackups',
        'dynamodb:UpdateTimeToLive',
        'dynamodb:DescribeTimeToLive',
        'dynamodb:DescribeTableReplicaAutoScaling',
        'dynamodb:TagResource',
        'dynamodb:UntagResource',
        'dynamodb:ListTagsOfResource',
      ],
      resources: [`arn:aws:dynamodb:${props.stack.region}:${props.stack.account}:table/${Aws.ACCOUNT_ID}-${Aws.STACK_NAME}-data-*`],
    })
  );

  // CloudFormation creates the S3 bucket using the caller's role
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        's3:CreateBucket',
        's3:DeleteBucket',
        's3:PutBucketPolicy',
        's3:GetBucketPolicy',
        's3:DeleteBucketPolicy',
        's3:PutBucketVersioning',
        's3:GetBucketVersioning',
        's3:PutBucketTagging',
        's3:PutLifecycleConfiguration',
        's3:GetLifecycleConfiguration',
        's3:PutEncryptionConfiguration',
        's3:GetEncryptionConfiguration',
        's3:PutBucketPublicAccessBlock',
        's3:GetBucketPublicAccessBlock',
        's3:GetBucketLocation',
        's3:PutBucketOwnershipControls',
        's3:GetBucketOwnershipControls',
      ],
      resources: [`arn:aws:s3:::${props.stack.account}-${Aws.STACK_NAME}-data-*`],
    })
  );

  // KMS permissions for SSE-KMS on DynamoDB and S3 (CloudFormation uses caller identity)
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['kms:DescribeKey', 'kms:CreateGrant'],
      effect: Effect.ALLOW,
      resources: [
        `arn:aws:kms:${props.stack.region}:${props.stack.account}:alias/aws/dynamodb`,
        `arn:aws:kms:${props.stack.region}:${props.stack.account}:alias/aws/s3`,
        `arn:aws:kms:${props.stack.region}:${props.stack.account}:key/*`,
      ],
      conditions: {
        Bool: { 'kms:GrantIsForAWSResource': 'true' },
      },
    })
  );

  // Tagging APIs (CloudFormation uses these broadly)
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['tag:GetResources', 'tag:TagResources', 'tag:UntagResources'],
      resources: ['*'],
    })
  );
}
