import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  DeployerWorkerLambda,
  StackIdentity,
  rootStackRequestTagConditions,
  rootStackResourceTagConditions,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }          from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Aws }                     from 'aws-cdk-lib';
import { Construct }               from 'constructs';

export interface MailboxCognitoDataDeployerWorkerProps {
  readonly artifactResolver: IArtifactResolver;
  /** S3 object ARN for the cognito data stack CloudFormation template. */
  readonly templateObjectArn: string;
  /** ARN pattern of the cognito data stack the worker manages. */
  readonly deployedStackArn: string;
}

/**
 * Worker Lambda that deploys the cognito data stack via CloudFormation: manages the stack,
 * reads its template from S3, and creates/manages its Cognito User Pool resources.
 *
 * Every ARN it builds uses `Aws.*` tokens rather than synthesis-time values, so account and
 * region resolve at deploy time.
 */
export class MailboxCognitoDataDeployerWorker extends DeployerWorkerLambda {
  private readonly rootStack: RootStack = { name: Aws.STACK_NAME, id: StackIdentity.guid };

  constructor(scope: Construct, id: string, props: MailboxCognitoDataDeployerWorkerProps) {
    super(scope, id, {
      artifactResolver: props.artifactResolver,
      deployedStackName: 'cognito',
    });

    // Grants inherited from the shared deployer worker
    this.grantStackLifecycle(props.deployedStackArn, true);
    this.grantTemplateValidation();
    this.grantArtifactRead([props.templateObjectArn]);
    this.grantTaggingApi();

    // Grants for the resources of the cognito data stack
    this.grantUserPoolCreation();
    this.grantUserPoolLifecycle();
    this.grantUserPoolTagging();
    this.grantUserPoolDomainLifecycle();
    this.grantUserPoolDomainRead();
    this.grantResourceServerLifecycle();
    this.grantGroupLifecycle();
  }

  // CreateUserPool binds to no resource type (cognito-idp Service Reference, same shape as ACM
  // RequestCertificate), so aws:ResourceTag can never gate it: the pool does not exist yet.
  private grantUserPoolCreation(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:CreateUserPool'],
        resources: ['*'],      }),
    );
  }

  // These actions bind to the "userpool" resource type and act on a pool that already exists and
  // is already tagged, so aws:ResourceTag is satisfiable.
  private grantUserPoolLifecycle(): void {
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
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
          conditions,
        }),
      );
    }
  }

  // aws:TagKeys is multivalued, so it needs ForAllValues: a plain StringEquals never matches and
  // silently denies every tag write.
  private grantUserPoolTagging(): void {
    // On CREATE, CloudFormation sends the tags in the request against a still-untagged pool, so
    // aws:RequestTag matches and aws:ResourceTag cannot.
    for (const conditions of rootStackRequestTagConditions(this.rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cognito-idp:TagResource'],
          resources: ['*'],
          conditions: { ...conditions, ...this.tagKeyCondition() },
        }),
      );
    }
    // On UPDATE, CloudFormation sends only the changed tags, so the root-stack tags may be absent from the
    // request, but the pool is already tagged and aws:ResourceTag matches. The request-tag and
    // resource-tag statements together cover both.
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['cognito-idp:TagResource'],
          resources: ['*'],
          conditions: { ...conditions, ...this.tagKeyCondition() },
        }),
      );
    }
  }

  private grantUserPoolDomainLifecycle(): void {
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'cognito-idp:CreateUserPoolDomain',
            'cognito-idp:DeleteUserPoolDomain',
            'cognito-idp:UpdateUserPoolDomain',
          ],
          resources: ['*'],
          conditions,
        }),
      );
    }
  }

  // DescribeUserPoolDomain binds to no resource type (cognito-idp Service Reference), so it cannot
  // be tag-gated.
  private grantUserPoolDomainRead(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:DescribeUserPoolDomain'],
        resources: ['*'],
      }),
    );
  }

  private grantResourceServerLifecycle(): void {
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
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
          conditions,
        }),
      );
    }
  }

  private grantGroupLifecycle(): void {
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
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
          conditions,
        }),
      );
    }
  }
}
