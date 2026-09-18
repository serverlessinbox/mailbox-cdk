import { Aws } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import {
  DeployerWorkerLambda,
  ServerlessInboxTagKeys,
  rootStackRequestTagCondition,
  rootStackResourceTagCondition,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface MailboxCognitoDataDeployerWorkerProps {
  readonly artifactResolver: ICdkArtifactEngine;
  /** S3 object ARN for the cognito data stack CloudFormation template. */
  readonly templateObjectArn: string;
}

/**
 * Worker Lambda that deploys the cognito data stack via CloudFormation: manages the stack,
 * reads its template from S3, and creates/manages its Cognito User Pool resources.
 *
 * All ARN strings use `Aws.REGION`, `Aws.ACCOUNT_ID`, `Aws.STACK_NAME` — never synthesis-time
 * values — so they remain as CloudFormation tokens.
 */
export class MailboxCognitoDataDeployerWorker extends DeployerWorkerLambda {
  constructor(scope: Construct, id: string, props: MailboxCognitoDataDeployerWorkerProps) {
    super(scope, id, {
      artifactResolver: props.artifactResolver,
      serviceName: 'stack-deployer-cognito-worker',
    });

    this.grantStackLifecycle();
    this.grantTemplateValidation();
    this.grantTemplateRead(props.templateObjectArn);
    this.grantTaggingApiAccess();
    this.grantUserPoolCreation();
    this.grantUserPoolLifecycle();
    this.grantUserPoolTagging();
    this.grantUserPoolDomainLifecycle();
    this.grantUserPoolDomainRead();
    this.grantResourceServerLifecycle();
    this.grantGroupLifecycle();
  }

  private grantStackLifecycle(): void {
    const cognitoDataStackArn = `arn:aws:cloudformation:${Aws.REGION}:${Aws.ACCOUNT_ID}:stack/${Aws.STACK_NAME}-cognito/*`;

    // CloudFormation management of the cognito data stack
    this.addToRolePolicy(
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
  }

  private grantTemplateValidation(): void {
    // ValidateTemplate acts on S3 URLs, not stack ARNs — must be on *
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudformation:ValidateTemplate'],
        resources: ['*'],
      }),
    );
  }

  private grantTemplateRead(templateObjectArn: string): void {
    // Read the cognito data stack template from the artifact bucket
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [templateObjectArn],
      }),
    );
  }

  private grantTaggingApiAccess(): void {
    // AWS Tagging API — CloudFormation uses these broadly when managing tagged resources
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:GetResources', 'tag:TagResources', 'tag:UntagResources'],
        resources: ['*'],
      }),
    );
  }

  private grantUserPoolCreation(): void {
    // CreateUserPool binds to no resource type (confirmed against the IAM Service Reference:
    // cognito-idp.json Actions[CreateUserPool].Resources is absent, same shape as ACM
    // RequestCertificate) — aws:ResourceTag can never gate it since the pool doesn't exist yet.
    // Region+account scope only, same as every other unconditioned account-level action here.
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:CreateUserPool'],
        resources: ['*'],
      }),
    );
  }

  private grantUserPoolLifecycle(): void {
    // Cognito User Pool lifecycle — all bind to the "userpool" resource type, which the Service
    // Reference lists as supporting aws:ResourceTag/${TagKey}. These act on the ALREADY-CREATED,
    // already-tagged pool (creation is the statement above), so aws:ResourceTag is satisfiable here.
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:DeleteUserPool',
          'cognito-idp:DescribeUserPool',
          'cognito-idp:UpdateUserPool',
          'cognito-idp:SetUserPoolMfaConfig',
          'cognito-idp:GetUserPoolMfaConfig',
          'cognito-idp:UntagResource',
          'cognito-idp:ListTagsForResource',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    );
  }

  private grantUserPoolTagging(): void {
    // Tag keys applyServerlessInboxBaseTags/applyServerlessInboxComponentTag actually write onto
    // this pool at the cognito-data stack root (mailbox-cognito-data-stack.ts) — the only keys this
    // role may legitimately tag-write. Keep in lockstep with those two call sites, not invented here.
    const legitimateTagKeys = [
      ServerlessInboxTagKeys.product,
      ServerlessInboxTagKeys.rootStack,
      ServerlessInboxTagKeys.stack,
      ServerlessInboxTagKeys.component,
      ServerlessInboxTagKeys.version,
      ServerlessInboxTagKeys.deployerType,
    ];

    // TagResource on CREATE: CFN sends root-stack (and the other base/component tags) in-request
    // against a still-untagged pool, so aws:RequestTag matches and aws:ResourceTag cannot (see
    // iam-scoping §2). aws:TagKeys uses ForAllValues — a plain StringEquals never matches because
    // aws:TagKeys is multivalued (do not "simplify" this back to StringEquals; that silently breaks
    // every tag write, per the support-api.ts precedent).
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:TagResource'],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackRequestTagCondition(Aws.STACK_NAME),
          'ForAllValues:StringEquals': {
            'aws:TagKeys': legitimateTagKeys,
          },
        },
      }),
    );
    // TagResource on UPDATE: CFN sends only the changed tags, so root-stack may be absent from the
    // request (aws:RequestTag above won't match) — but the pool is already tagged from creation, so
    // aws:ResourceTag links it. Union of the two (own statements, per iam-scoping §2) covers both.
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:TagResource'],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
          'ForAllValues:StringEquals': {
            'aws:TagKeys': legitimateTagKeys,
          },
        },
      }),
    );
  }

  private grantUserPoolDomainLifecycle(): void {
    // Cognito User Pool Domain — all but Describe bind to "userpool" (ResourceTag-satisfiable, same
    // reasoning as the lifecycle statement above).
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:CreateUserPoolDomain',
          'cognito-idp:DeleteUserPoolDomain',
          'cognito-idp:UpdateUserPoolDomain',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    );
  }

  private grantUserPoolDomainRead(): void {
    // DescribeUserPoolDomain binds to no resource type at all (Service Reference:
    // Actions[DescribeUserPoolDomain].Resources is absent) and so cannot be tag-gated — kept
    // unconditioned like CreateUserPool.
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:DescribeUserPoolDomain'],
        resources: ['*'],
      }),
    );
  }

  private grantResourceServerLifecycle(): void {
    // Cognito Resource Server (OAuth scopes) — all bind to "userpool" (ResourceTag-satisfiable).
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:CreateResourceServer',
          'cognito-idp:DeleteResourceServer',
          'cognito-idp:DescribeResourceServer',
          'cognito-idp:UpdateResourceServer',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    );
  }

  private grantGroupLifecycle(): void {
    // Cognito Groups — all bind to "userpool" (ResourceTag-satisfiable).
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:CreateGroup',
          'cognito-idp:DeleteGroup',
          'cognito-idp:GetGroup',
          'cognito-idp:UpdateGroup',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: rootStackResourceTagCondition(Aws.STACK_NAME),
        },
      }),
    );
  }
}
