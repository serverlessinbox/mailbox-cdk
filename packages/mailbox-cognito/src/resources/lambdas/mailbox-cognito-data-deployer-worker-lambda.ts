import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import {
  DeployerWorkerLambda,
  StackIdentity,
  rootStackRequestTagConditions,
  rootStackResourceTagConditions,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }              from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement }     from 'aws-cdk-lib/aws-iam';
import type { PolicyStatementProps }   from 'aws-cdk-lib/aws-iam';
import { Aws }                         from 'aws-cdk-lib';
import { Construct }                   from 'constructs';

import { COGNITO_DEPLOYED_STACK_NAME } from '../../data-stack/mailbox-cognito-data-stack-contract';

export interface MailboxCognitoDataDeployerWorkerLambdaProps {
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
export class MailboxCognitoDataDeployerWorkerLambda extends DeployerWorkerLambda {
  private readonly rootStack: RootStack = { name: Aws.STACK_NAME, id: StackIdentity.guid };

  constructor(scope: Construct, id: string, props: MailboxCognitoDataDeployerWorkerLambdaProps) {
    super(scope, id, {
      artifactResolver:  props.artifactResolver,
      deployedStackName: COGNITO_DEPLOYED_STACK_NAME,
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
    this.allowOnAllResources(['cognito-idp:CreateUserPool']);
  }

  // These actions bind to the "userpool" resource type and act on a pool that already exists and
  // is already tagged, so aws:ResourceTag is satisfiable.
  private grantUserPoolLifecycle(): void {
    this.allowOnRootStackResources([
      'cognito-idp:DeleteUserPool',
      'cognito-idp:DescribeUserPool',
      'cognito-idp:UpdateUserPool',
      'cognito-idp:SetUserPoolMfaConfig',
      'cognito-idp:GetUserPoolMfaConfig',
      'cognito-idp:UntagResource',
      'cognito-idp:ListTagsForResource',
    ]);
  }

  // aws:TagKeys is multivalued, so it needs ForAllValues: a plain StringEquals never matches and
  // silently denies every tag write.
  private grantUserPoolTagging(): void {
    // On CREATE, CloudFormation sends the tags in the request against a still-untagged pool, so
    // aws:RequestTag matches and aws:ResourceTag cannot.
    for (const conditions of rootStackRequestTagConditions(this.rootStack)) {
      this.allowOnAllResources(['cognito-idp:TagResource'], { ...conditions, ...this.tagKeyCondition() });
    }
    // On UPDATE, CloudFormation sends only the changed tags, so the root-stack tags may be absent from the
    // request, but the pool is already tagged and aws:ResourceTag matches. The request-tag and
    // resource-tag statements together cover both.
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
      this.allowOnAllResources(['cognito-idp:TagResource'], { ...conditions, ...this.tagKeyCondition() });
    }
  }

  private grantUserPoolDomainLifecycle(): void {
    this.allowOnRootStackResources([
      'cognito-idp:CreateUserPoolDomain',
      'cognito-idp:DeleteUserPoolDomain',
      'cognito-idp:UpdateUserPoolDomain',
    ]);
  }

  // DescribeUserPoolDomain binds to no resource type (cognito-idp Service Reference), so it cannot
  // be tag-gated.
  private grantUserPoolDomainRead(): void {
    this.allowOnAllResources(['cognito-idp:DescribeUserPoolDomain']);
  }

  private grantResourceServerLifecycle(): void {
    this.allowOnRootStackResources([
      'cognito-idp:CreateResourceServer',
      'cognito-idp:DeleteResourceServer',
      'cognito-idp:DescribeResourceServer',
      'cognito-idp:UpdateResourceServer',
    ]);
  }

  private grantGroupLifecycle(): void {
    this.allowOnRootStackResources([
      'cognito-idp:CreateGroup',
      'cognito-idp:DeleteGroup',
      'cognito-idp:GetGroup',
      'cognito-idp:UpdateGroup',
    ]);
  }

  /** One statement per condition set that admits the resources the root stack owns. */
  private allowOnRootStackResources(actions: string[]): void {
    for (const conditions of rootStackResourceTagConditions(this.rootStack)) {
      this.allowOnAllResources(actions, conditions);
    }
  }

  private allowOnAllResources(actions: string[], conditions?: PolicyStatementProps['conditions']): void {
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions,
        resources: ['*'],
        conditions,
      }),
    );
  }
}
