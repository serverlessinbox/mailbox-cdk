import type { IArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import { PolicyStatement }                from 'aws-cdk-lib/aws-iam';
import { Duration }                       from 'aws-cdk-lib';
import { Construct }                      from 'constructs';

import { KIT_ARTIFACT_PACKAGE }           from '../../artifacts/kit-artifact-package';
import { parentStackStatusReadStatement } from '../../grants/parent-stack-status-read';
import { ServerlessInboxTagKeys }         from '../../runtime/handler-kit/tag-keys';
import type { IArtifactObject }           from '../artifacts/artifact-object';
import type { IDeployedStack }            from '../stacks/deployed-stack';

import { TypeScriptLambda }               from './ts-lambda';

/** What `DeployerWorkerLambda` needs: the artifact resolver for its code and the name of the stack its deployer deploys. */
export interface DeployerWorkerLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  /** Composes into `SERVICE_NAME`, which keeps each deployer's function distinguishable while they share the 'stack-deployer' lambdaId. */
  readonly deployedStackName: string;
}

/** The `Condition` block of a tag-write statement: the tag keys it admits, compared with `ForAllValues:StringLike`. */
export interface TagKeysCondition {
  readonly 'ForAllValues:StringLike': AdmittedTagKeys;
}

/** The tag keys a tag-write statement admits. */
export interface AdmittedTagKeys {
  readonly 'aws:TagKeys': string[];
}

/**
 * CloudFormation tags every resource it creates with its own keys and sends them in the same tag request as
 * ours, so every `aws:TagKeys` condition a deployer worker writes must admit them alongside the sub-stack keys.
 */
const CLOUDFORMATION_TAG_KEY_PATTERN = 'aws:cloudformation:*';

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
      lambdaId:         'stack-deployer',
      pipeline:         'infra',
      serviceName:      `stack-deployer-${props.deployedStackName}-worker`,
      artifactResolver: props.artifactResolver,
      packageName:      KIT_ARTIFACT_PACKAGE,
      handler:          'index.workerHandler',
      timeout:          Duration.minutes(15),
      memorySize:       512,
    });

    this.subStackTagKeys = [
      ServerlessInboxTagKeys.product,
      ServerlessInboxTagKeys.rootStack,
      ServerlessInboxTagKeys.rootStackId,
      ServerlessInboxTagKeys.stack,
      ServerlessInboxTagKeys.component,
      ServerlessInboxTagKeys.deployerType,
      ServerlessInboxTagKeys.name,
      ServerlessInboxTagKeys.description,
    ];

    this.grantReadParentStackStatus();
  }

  /** Manages the given stack. */
  protected grantStackLifecycle(stack: IDeployedStack): void {
    stack.grantLifecycle(this);
  }

  /** Lets the role read the deployed template of the given stack. */
  protected grantStackTemplateRead(stack: IDeployedStack): void {
    stack.grantTemplateRead(this);
  }

  /** ValidateTemplate acts on a template URL rather than a stack, so it cannot be scoped. */
  protected grantTemplateValidation(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['cloudformation:ValidateTemplate'],
        resources: ['*'],
      })
    );
  }

  /** CloudFormation fetches the template and any artifact it references with this role's identity, so each object must be readable here. */
  protected grantArtifactRead(artifacts: IArtifactObject[]): void {
    for (const artifact of artifacts) {
      artifact.grantRead(this);
    }
  }

  /**
   * GetResources is read-only enumeration and cannot be scoped. Tagging is limited to the sub-stack tag
   * keys, the CloudFormation keys and `additionalTagKeys`, so the role cannot rewrite the root-stack tag that
   * scopes its own grants or inject tags another policy trusts.
   */
  protected grantTaggingApi(additionalTagKeys: string[] = []): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['tag:GetResources'],
        resources: ['*'],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        actions:    ['tag:TagResources', 'tag:UntagResources'],
        resources:  ['*'],
        conditions: this.tagKeyCondition(additionalTagKeys),
      })
    );
  }

  /** The `aws:TagKeys` condition every tag-write statement uses: the sub-stack keys, `additionalTagKeys`, and CloudFormation's own keys by pattern. */
  protected tagKeyCondition(additionalTagKeys: string[] = []): TagKeysCondition {
    return {
      'ForAllValues:StringLike': {
        'aws:TagKeys': [...this.subStackTagKeys, ...additionalTagKeys, CLOUDFORMATION_TAG_KEY_PATTERN],
      },
    };
  }

  /** Lets the worker ask whether the parent stack is rolling back before it answers a failed Update. */
  private grantReadParentStackStatus(): void {
    this.addToRolePolicy(parentStackStatusReadStatement());
  }
}
