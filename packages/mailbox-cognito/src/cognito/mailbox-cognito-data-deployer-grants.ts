import { Aws } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

export interface CognitoDataDeployerGrantProps {
  /** S3 object ARN for the cognito data stack CloudFormation template. */
  readonly templateObjectArn: string;
}

/**
 * Grants the cognito data stack deployer worker Lambda the IAM permissions it needs to:
 * - Manage the cognito data CloudFormation stack
 * - Read the cognito data stack template from S3
 * - Create and manage Cognito User Pool resources
 *
 * All ARN strings use `Aws.REGION`, `Aws.ACCOUNT_ID`, `Aws.STACK_NAME` — never synthesis-time
 * values — so they remain as CloudFormation tokens.
 */
export function grantCognitoDataDeployerPermissions(
  worker: IFunction,
  props: CognitoDataDeployerGrantProps,
): void {
  const cognitoDataStackArn = `arn:aws:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/${Aws.STACK_NAME}-cognito/*`;

  // CloudFormation management of the cognito data stack
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplate',
        'cloudformation:GetTemplateSummary',
        'cloudformation:GetStackPolicy',
        'cloudformation:SetStackPolicy',
      ],
      resources: [cognitoDataStackArn],
    }),
  );

  // ValidateTemplate acts on S3 URLs, not stack ARNs — must be on *
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['cloudformation:ValidateTemplate'],
      resources: ['*'],
    }),
  );

  // Read the cognito data stack template from the artifact bucket
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [props.templateObjectArn],
    }),
  );

  // AWS Tagging API — CloudFormation uses these broadly when managing tagged resources
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['tag:GetResources', 'tag:TagResources', 'tag:UntagResources'],
      resources: ['*'],
    }),
  );

  // Cognito User Pool lifecycle
  worker.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:CreateUserPool',
        'cognito-idp:DeleteUserPool',
        'cognito-idp:DescribeUserPool',
        'cognito-idp:UpdateUserPool',
        'cognito-idp:SetUserPoolMfaConfig',
        'cognito-idp:GetUserPoolMfaConfig',
        'cognito-idp:TagResource',
        'cognito-idp:UntagResource',
        'cognito-idp:ListTagsForResource',
      ],
      resources: ['*'],
    }),
  );

  // Cognito User Pool Domain
  worker.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:CreateUserPoolDomain',
        'cognito-idp:DeleteUserPoolDomain',
        'cognito-idp:DescribeUserPoolDomain',
        'cognito-idp:UpdateUserPoolDomain',
      ],
      resources: ['*'],
    }),
  );

  // Cognito Resource Server (OAuth scopes)
  worker.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:CreateResourceServer',
        'cognito-idp:DeleteResourceServer',
        'cognito-idp:DescribeResourceServer',
        'cognito-idp:UpdateResourceServer',
      ],
      resources: ['*'],
    }),
  );

  // Cognito Groups
  worker.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cognito-idp:CreateGroup',
        'cognito-idp:DeleteGroup',
        'cognito-idp:GetGroup',
        'cognito-idp:UpdateGroup',
      ],
      resources: ['*'],
    }),
  );
}

/**
 * Grants using the scope-derived template ARN (convenience overload for callers that have a
 * CDK scope but not a pre-resolved ARN string).
 */
// Deprecated: grantCognitoDataDeployerPermissionsFromScope was removed to avoid local engine creation.
// Callers should use grantCognitoDataDeployerPermissions directly with a pre-computed templateObjectArn.
