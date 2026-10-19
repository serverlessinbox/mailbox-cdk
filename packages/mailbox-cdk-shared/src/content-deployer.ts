import { createHash } from 'node:crypto';
import { Construct, type IDependable } from 'constructs';
import { Aws, Duration, CustomResource, Stack, Token, Tokenization } from 'aws-cdk-lib';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda } from './ts-lambda';
import type { IStaticContentSource } from './static-content-source';
import { getOrCreateSharedGroup } from './shared-group';
import type {
  ContentDeployerResourceProperties,
  StaticContentSourceSpec,
} from './ts-lambdas/content-deployer/resource-properties';

/** What `StaticContentDeployer.deploy` deploys, and where. */
export interface StaticContentDeploymentProps {
  readonly targetBucket: IBucket;

  /** The single source to deploy. To deploy several sources, call `deploy()` once per source. */
  readonly source: IStaticContentSource;
}

/** What `StaticContentDeployer.invalidate` invalidates. */
export interface StaticContentInvalidationProps {
  readonly distributionId: string;
  readonly paths: string[];
}

/** A deployment made from a scope: the resource to depend on, and the identity of the content it deploys. */
interface TrackedDeployment {
  readonly resource: IDependable;
  readonly identity: string;
}

const TOKEN_PLACEHOLDER = '<token>';

/**
 * The one content-deployer Lambda of a stack, and the factory of the custom resources it serves:
 * `deploy()` writes static content into a bucket, and `invalidate()` clears the CloudFront cache once
 * the content deployed from the same scope is in place.
 */
export class StaticContentDeployer extends TypeScriptLambda {
  private readonly deploymentsByScope = new Map<Construct, TrackedDeployment[]>();

  private constructor(scope: Construct, id: string, artifactResolver: IArtifactResolver) {
    super(scope, id, {
      lambdaId: 'content-deployer',
      pipeline: 'infra',
      artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
    });

    this.grantParentStackStatusRead();
  }

  /**
   * Get-or-create the one shared content-deployer Lambda for this Stack.
   * The singleton is placed under a "shared" group construct at stack root.
   */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): StaticContentDeployer {
    const stack = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing = sharedGroup.node.tryFindChild('content-deployer');
    if (existing instanceof StaticContentDeployer) {
      return existing;
    }
    return new StaticContentDeployer(sharedGroup, 'content-deployer', artifactResolver);
  }

  /**
   * Deploys one source into the target bucket through its own custom resource, and grants the Lambda the
   * S3 access that source needs. Returns the custom resource so other resources can depend on it.
   */
  deploy(scope: Construct, id: string, props: StaticContentDeploymentProps): CustomResource {
    this.grantDeployment(props);

    const properties: ContentDeployerResourceProperties = {
      targetBucket: props.targetBucket.bucketName,
      sources: [props.source.spec],
    };
    const resource = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::ContentDeployment',
      properties,
    });

    this.trackDeployment(scope, resource, props.source.spec);

    return resource;
  }

  /**
   * Invalidates `paths` of a CloudFront distribution once the content deployed from `scope` is in place:
   * the resource depends on every `deploy()` made from the same scope. Its `deploymentNonce` is derived
   * from those deployments' content, so the properties change exactly when the content does.
   * CloudFormation only re-invokes a custom resource whose properties changed.
   */
  invalidate(scope: Construct, id: string, props: StaticContentInvalidationProps): CustomResource {
    this.grantInvalidation(props.distributionId);

    const deployments = this.deploymentsByScope.get(scope) ?? [];
    const properties: ContentDeployerResourceProperties = {
      sources: [],
      distributionId: props.distributionId,
      invalidationPaths: props.paths,
      deploymentNonce: this.deploymentNonce(deployments),
    };
    const resource = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::ContentInvalidation',
      properties,
    });

    for (const deployment of deployments) {
      resource.node.addDependency(deployment.resource);
    }

    return resource;
  }

  private grantParentStackStatusRead(): void {
    const stack = Stack.of(this);
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [stack.stackId],
      }),
    );
  }

  private grantDeployment(props: StaticContentDeploymentProps): void {
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: props.source.objectArns(props.targetBucket),
      }),
    );

    if (props.source.spec.kind === 'zip') {
      this.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['s3:ListBucket'],
          resources: [props.targetBucket.bucketArn],
        }),
      );
    }

    if (props.source.sourceArns) {
      this.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:GetObjectVersion'],
          resources: props.source.sourceArns(),
        }),
      );
    }
  }

  private grantInvalidation(distributionId: string): void {
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/${distributionId}`],
      }),
    );
  }

  private trackDeployment(scope: Construct, resource: IDependable, spec: StaticContentSourceSpec): void {
    const deployments = this.deploymentsByScope.get(scope) ?? [];
    deployments.push({ resource, identity: this.sourceIdentity(spec) });
    this.deploymentsByScope.set(scope, deployments);
  }

  /**
   * Identifies a deployed source by its content: two deploys of the same content have the same identity.
   * A zip source is identified by its bucket, key and version; a data source by a hash of its literal text
   * followed by the tokens of its body, so a large body is not copied into the invalidation resource's
   * properties.
   */
  private sourceIdentity(spec: StaticContentSourceSpec): string {
    if (spec.kind === 'zip') {
      return `zip:${spec.sourceBucket}:${spec.sourceKey}:${spec.sourceVersionId ?? ''}`;
    }
    return this.dataSourceIdentity(spec.key, spec.body);
  }

  /**
   * A token's placeholder text differs between synths, so the hash covers the body with every token
   * replaced by one fixed placeholder. The tokens follow the hash as tokens, which CloudFormation resolves
   * at deploy time: the identity changes when a referenced value changes, and not otherwise.
   */
  private dataSourceIdentity(key: string, body: string): string {
    const fragments = Tokenization.reverseString(body);
    const maskedBody = fragments.mapTokens({ mapToken: () => TOKEN_PLACEHOLDER }).join({ join: (left, right) => `${left}${right}` });
    const digest = createHash('sha256').update(maskedBody).digest('hex');
    const tokens = fragments.tokens.map((token) => Token.asString(token));
    return ['data', key, digest, ...tokens].join(':');
  }

  private deploymentNonce(deployments: TrackedDeployment[]): string | undefined {
    return deployments.length > 0 ? deployments.map((deployment) => deployment.identity).join('|') : undefined;
  }
}
