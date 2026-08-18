import { Construct } from 'constructs';
import { Duration, CustomResource, Stack } from 'aws-cdk-lib';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { ICdkArtifactEngine } from './artifact-engine';
import { TypeScriptLambda } from './ts-lambda';
import type { StaticContentSourceSpec } from './static-content-source-spec';
import { getOrCreateSharedGroup } from './shared-group';

export type { StaticContentSourceSpec } from './static-content-source-spec';

export interface StaticContentWriteOptions {
  readonly contentType?: string;
  readonly cacheControl?: string;
}

export interface StaticContentZipOptions {
  readonly sourceVersionId?: string;
}

/** Synth-time-only source descriptor. `.spec` is what actually gets embedded in the CustomResource's
 *  `properties.sources` array (see `StaticContentDeployer.deploy()` below); `.objectArns(bucket)` is
 *  the structural answer to the IAM-scoping critique — callers grant IAM from this, never by
 *  hand-writing `bucket.arnForObjects(...)` themselves. Covers `s3:PutObject`/`s3:DeleteObject` object
 *  scope only — `s3:ListBucket` (a bucket-level, not object-level, action) stays a separate, unchanged,
 *  caller-added grant where a zip source's enumeration needs it (see `MailboxUi` call site below).
 *  `sourceArns()` returns the ARNs for source-read access (zip sources only; data sources have nothing
 *  to read, their content is inline). */
export interface IStaticContentSource {
  readonly spec: StaticContentSourceSpec;
  objectArns(bucket: IBucket): string[];
  sourceArns?(): string[];
}

export abstract class StaticContentSource {
  private constructor() {} // static factory only, mirrors aws-s3-deployment's real `Source` class shape

  /** A literal write at an exact, known key — e.g. a config/metadata file. IAM is scoped to exactly
   *  this one object ARN. No source to read — content is inline. */
  static data(key: string, body: string, options: StaticContentWriteOptions = {}): IStaticContentSource {
    return {
      spec: { kind: 'data', key, body, ...options },
      objectArns: (bucket) => [bucket.arnForObjects(key)],
      // No sourceArns — data sources have no external source to read
    };
  }

  /** A zip-unpack-to-prefix deployment — e.g. a UI bundle. `sourceBucketName` is a plain bucket-name
   *  string, not `IBucket`: the real source (an artifact-registry bucket resolved via
   *  `ICdkArtifactEngine.resolve()`) has no `IBucket` construct reference in this stack at all — it's
   *  an external bucket, always addressed by name/key. Resulting keys aren't known at synth time, so
   *  IAM is necessarily scoped to a prefix wildcard, not exact keys — the one case where a wildcard is
   *  correct, not merely convenient. */
  static zipFromBucket(
    sourceBucketName: string,
    sourceKey: string,
    targetPrefix: string,
    options: StaticContentZipOptions = {},
  ): IStaticContentSource {
    const normalizedPrefix = targetPrefix.endsWith('/') ? targetPrefix : `${targetPrefix}/`;
    return {
      spec: { kind: 'zip', sourceBucket: sourceBucketName, sourceKey, targetPrefix: normalizedPrefix, ...options },
      objectArns: (bucket) => [bucket.arnForObjects(`${normalizedPrefix}*`)],
      sourceArns: () => [`arn:aws:s3:::${sourceBucketName}/${sourceKey}`],
    };
  }
}

export interface StaticContentDeploymentProps {
  readonly targetBucket: string;
  /** A single, closed discriminated source — data write or zip unpack. For multiple independent
   *  deployments (e.g. UI bundle + config file), call deploy() separately for each. */
  readonly source: IStaticContentSource;
}

export interface StaticContentInvalidationProps {
  readonly distributionId: string;
  readonly paths: string[];
  readonly deploymentNonce?: string;
}

export class StaticContentDeployer extends TypeScriptLambda {
  private readonly deploymentsByScope = new Map<Construct, CustomResource[]>();

  /**
   * Get-or-create the one shared content-deployer Lambda for this Stack.
   * The singleton is placed under a "shared" group construct at stack root.
   */
  static getOrCreate(scope: Construct, artifactResolver: ICdkArtifactEngine): StaticContentDeployer {
    const stack = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing = sharedGroup.node.tryFindChild('content-deployer');
    if (existing instanceof StaticContentDeployer) {
      return existing;
    }
    return new StaticContentDeployer(sharedGroup, 'content-deployer', artifactResolver);
  }

  private constructor(scope: Construct, id: string, artifactResolver: ICdkArtifactEngine) {
    // Whichever caller's resolver wins the race, it MUST know about 'mailbox-cdk-shared' —
    // this construct's own Lambda lives there regardless of who constructed the singleton first.
    // Idempotent (Set-backed). Must register BEFORE calling super(), which will try to resolve.
    artifactResolver.registerPackages(['mailbox-cdk-shared']);

    super(scope, id, {
      lambdaId: 'content-deployer', // artifact identifier in mailbox-cdk-shared package
      artifactResolver,
      packageName: 'mailbox-cdk-shared', // Lambda artifacts published under mailbox-cdk-shared package
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
    });
  }

  /** Deploy a single source (data write or zip unpack) to the target bucket. Each source gets its own
   *  CustomResource; call this separately for each source. IAM grants are derived from the source's own
   *  `.objectArns()` and `.sourceArns()` methods — callers grant what they get from those, never
   *  hand-written wildcards. The method wires the CustomResource → shared Lambda plumbing and flattens
   *  the single source down to its plain, CFN-serializable `.spec` value. Returns the CustomResource
   *  so it can be depended on by other resources (e.g., invalidation). */
  deploy(scope: Construct, id: string, props: StaticContentDeploymentProps): CustomResource {
    const bucketRef = Bucket.fromBucketName(scope, `${id}-bucket-ref`, props.targetBucket);

    // Grant target-write access derived from the single source
    const objectArns = props.source.objectArns(bucketRef);
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: objectArns,
      }),
    );

    // Grant s3:ListBucket only when source is a zip (requires enumeration)
    if (props.source.spec.kind === 'zip') {
      this.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['s3:ListBucket'],
          resources: [bucketRef.bucketArn],
        }),
      );
    }

    // Grant source-read access, only if sourceArns is defined (zip sources only)
    if (props.source.sourceArns) {
      this.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:GetObjectVersion'],
          resources: props.source.sourceArns(),
        }),
      );
    }

    // Create and track the CustomResource
    const resource = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::ContentDeployment',
      properties: {
        targetBucket: props.targetBucket,
        sources: [props.source.spec],
        // These fields are omitted from deploy() — only used by invalidate()
        distributionId: undefined,
        invalidationPaths: undefined,
        deploymentNonce: undefined,
      },
    });

    // Track this deployment by its calling scope for invalidate() to wire dependencies
    const tracked = this.deploymentsByScope.get(scope) ?? [];
    tracked.push(resource);
    this.deploymentsByScope.set(scope, tracked);

    return resource;
  }

  /** Invalidate a CloudFront distribution after content deployments complete. Wires automatic
   *  dependencies on all prior `deploy()` calls from the same calling scope, so invalidation
   *  always follows the deployments it targets. */
  invalidate(scope: Construct, id: string, props: StaticContentInvalidationProps): CustomResource {
    // Grant CloudFront invalidation permission
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: ['*'],
      }),
    );

    // Create the invalidation CustomResource with empty sources (invalidation-only call)
    const resource = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::ContentInvalidation',
      properties: {
        targetBucket: undefined,
        sources: [],
        distributionId: props.distributionId,
        invalidationPaths: props.paths,
        deploymentNonce: props.deploymentNonce,
      },
    });

    // Wire dependencies: this invalidation must follow all prior deployments in the same scope
    (this.deploymentsByScope.get(scope) ?? []).forEach((deployment) => {
      resource.node.addDependency(deployment);
    });

    return resource;
  }
}
