import type { IArtifactResolver }               from '@serverlessinbox/artifact-registry-cdk';
import { DeployerWorkerLambda }                 from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactObject, IDeployedStack } from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement }              from 'aws-cdk-lib/aws-iam';
import { Aws, IResolvable }                     from 'aws-cdk-lib';
import { Construct }                            from 'constructs';

export interface MailboxDataDeployerWorkerLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly dataStack:        IDeployedStack;
  readonly dataStackName:    string;
  readonly template:         IArtifactObject;
  readonly nameBase:         string | IResolvable;
}

/**
 * Worker Lambda of the mailbox data sub-stack deployer. Owns the permissions CloudFormation needs,
 * acting as this role, to create, update and delete the data stack's DynamoDB tables and S3 bucket.
 * It does not decide when to deploy.
 */
export class MailboxDataDeployerWorkerLambda extends DeployerWorkerLambda {
  constructor(scope: Construct, id: string, props: MailboxDataDeployerWorkerLambdaProps) {
    super(scope, id, {
      artifactResolver:  props.artifactResolver,
      deployedStackName: 'data',
    });

    // Grants inherited from the shared deployer worker
    this.grantStackLifecycle(props.dataStack);
    this.grantTemplateValidation();
    this.grantArtifactRead([props.template]);
    this.grantTaggingApi();

    // Grants for the resources of the data stack
    this.grantDynamoDbTableManagement(props.nameBase);
    this.grantS3BucketManagement(props.nameBase);
    this.grantKmsAccess();
  }

  // `nameBase` is already the data stack name (e.g. 'stackname-data'), so the tables are named
  // `${account}-${nameBase}-<resourceName>`, with no additional '-data-' segment.
  private grantDynamoDbTableManagement(nameBase: string | IResolvable): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
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
        resources: [`arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${Aws.ACCOUNT_ID}-${nameBase}-*`],
      })
    );
  }

  // The bucket is named like the tables: `${account}-${nameBase}-<resourceName>`.
  private grantS3BucketManagement(nameBase: string | IResolvable): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
          's3:CreateBucket',
          's3:DeleteBucket',
          's3:PutBucketPolicy',
          's3:GetBucketPolicy',
          's3:DeleteBucketPolicy',
          's3:PutBucketVersioning',
          's3:GetBucketVersioning',
          's3:PutBucketTagging',
          's3:GetBucketTagging',
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
        resources: [`arn:aws:s3:::${Aws.ACCOUNT_ID}-${nameBase}-*`],
      })
    );
  }

  // SSE-KMS on the tables and the bucket.
  private grantKmsAccess(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:    ['kms:DescribeKey', 'kms:CreateGrant'],
        effect:     Effect.ALLOW,
        resources:  [
          `arn:aws:kms:${Aws.REGION}:${Aws.ACCOUNT_ID}:alias/aws/dynamodb`,
          `arn:aws:kms:${Aws.REGION}:${Aws.ACCOUNT_ID}:alias/aws/s3`,
          `arn:aws:kms:${Aws.REGION}:${Aws.ACCOUNT_ID}:key/*`,
        ],
        conditions: {
          Bool: { 'kms:GrantIsForAWSResource': 'true' },
        },
      })
    );
  }
}
