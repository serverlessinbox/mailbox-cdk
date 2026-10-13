import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ServerlessInboxTagKeys } from '../serverless-inbox-tags';
import { TypeScriptLambda } from '../ts-lambda';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';

export interface DeployerWorkerLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  /** Composes into `SERVICE_NAME`, which keeps each deployer's function distinguishable while they share the 'stack-deployer' lambdaId. */
  readonly deployedStackName: string;
}

/**
 * The Lambda that performs a deployer's CloudFormation operations and polls them to completion. It
 * calls CloudFormation without a `RoleArn`, so CloudFormation acts with this role's permissions:
 * the grants every sub-stack deployment needs live here, and a subclass adds the ones for the
 * resources of its own template.
 */
export class DeployerWorkerLambda extends TypeScriptLambda {
  /** The tag keys every sub-stack deployment writes; the tagging grant allows these and nothing else, except what a subclass adds. */
  protected readonly subStackTagKeys: readonly string[];

  constructor(scope: Construct, id: string, props: DeployerWorkerLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-deployer',
      pipeline: 'infra',
      serviceName: `stack-deployer-${props.deployedStackName}-worker`,
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    this.subStackTagKeys = [
      ServerlessInboxTagKeys.product,
      ServerlessInboxTagKeys.rootStack,
      ServerlessInboxTagKeys.stack,
      ServerlessInboxTagKeys.component,
      ServerlessInboxTagKeys.version,
      ServerlessInboxTagKeys.deployerType,
    ];
  }

  /** Manages the given stack; `readsTemplate` also lets the role read the stack's deployed template. */
  protected grantStackLifecycle(stackArn: string, readsTemplate = false): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          ...(readsTemplate ? ['cloudformation:GetTemplate'] : []),
          'cloudformation:GetTemplateSummary',
          'cloudformation:GetStackPolicy',
          'cloudformation:SetStackPolicy',
        ],
        resources: [stackArn],
      })
    );
  }

  /** ValidateTemplate acts on a template URL rather than a stack, so it cannot be scoped. */
  protected grantTemplateValidation(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudformation:ValidateTemplate'],
        resources: ['*'],
      })
    );
  }

  /** CloudFormation fetches the template and any artifact it references with this role's identity, so each object must be readable here. */
  protected grantArtifactRead(objectArns: string[]): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: objectArns,
      })
    );
  }

  /**
   * GetResources is read-only enumeration and cannot be scoped. Tagging is limited to the sub-stack tag
   * keys plus `additionalTagKeys`, so the role cannot rewrite the root-stack tag that scopes its own
   * grants or inject tags another policy trusts.
   */
  protected grantTaggingApi(additionalTagKeys: string[] = []): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:GetResources'],
        resources: ['*'],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:TagResources', 'tag:UntagResources'],
        resources: ['*'],
        conditions: {
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [...this.subStackTagKeys, ...additionalTagKeys],
          },
        },
      })
    );
  }
}
