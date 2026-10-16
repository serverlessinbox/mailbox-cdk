import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { getOrCreateSharedGroup } from './shared-group';
import { applyServerlessInboxComponentTag } from './serverless-inbox-tags';
import { StackHelpersLambda } from './stack-helpers-lambda';
import type { StackHelpersResourceProperties } from './ts-lambdas/stack-helpers/resource-properties';

/**
 * The hosted zone and data stack name that the domain name and S3-safe stack name are derived from.
 */
export interface StackHelpersMailboxDataProps {
  /** An empty string means no hosted zone: the lookup is skipped and `derivedDomainName` is empty. */
  readonly hostedZoneId: string;
  readonly dataStackName: string;
}

/**
 * Deploy-time CloudFormation tokens for the derived values, so not usable in synth-time decisions.
 */
export interface StackHelpersMailboxData {
  readonly derivedDomainName: string;
  readonly derivedS3SafeDataStackName: string;
}

/**
 * Singleton construct for domain name and S3-safe stack name derivation.
 * One shared lookup/sanitization Lambda per Stack, with multiple consumers
 * each attaching their own CfnCustomResource.
 */
export class StackHelpers extends Construct {
  private readonly fn: StackHelpersLambda;

  private constructor(scope: Construct, id: string, artifactResolver: IArtifactResolver) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ops');

    this.fn = new StackHelpersLambda(this, 'handler', { artifactResolver });
  }

  /** One instance per stack, placed under the stack's shared group. */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): StackHelpers {
    const stack = cdk.Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing = sharedGroup.node.tryFindChild('stack-helpers');
    if (existing) {
      // cast: the id 'stack-helpers' under the shared group is only created by the line below.
      return existing as StackHelpers;
    }
    return new StackHelpers(sharedGroup, 'stack-helpers', artifactResolver);
  }

  /** Attaches the caller's own custom resource under `scope`. */
  resolveMailboxData(
    scope: Construct,
    id: string,
    props: StackHelpersMailboxDataProps,
  ): StackHelpersMailboxData {
    const cr = this.attach(scope, id, {
      HostedZoneId: props.hostedZoneId,
      DataStackName: props.dataStackName,
    });
    return {
      derivedDomainName: cr.getAttString('domainName'),
      derivedS3SafeDataStackName: cr.getAttString('s3SafeDataStackName'),
    };
  }

  /** Attaches the caller's own custom resource under `scope`; the result is a deploy-time token. */
  resolveCognitoDomainPrefix(scope: Construct, id: string, hostedZoneId: string): string {
    const cr = this.attach(scope, id, {
      HostedZoneId: hostedZoneId,
      Fallback: cdk.Aws.STACK_NAME,
    });
    return cr.getAttString('cognitoDomainPrefix');
  }

  private attach(
    scope: Construct,
    id: string,
    properties: StackHelpersResourceProperties,
  ): cdk.CustomResource {
    return new cdk.CustomResource(scope, id, {
      serviceToken: this.fn.functionArn,
      serviceTimeout: cdk.Duration.seconds(90),
      resourceType: 'Custom::StackHelpers',
      properties,
    });
  }
}
