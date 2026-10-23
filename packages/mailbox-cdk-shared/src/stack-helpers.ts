import type { IArtifactResolver }              from '@serverlessinbox/artifact-registry-cdk';
import * as cdk                                from 'aws-cdk-lib';
import { Construct }                           from 'constructs';

import { StackHelpersLambda }                  from './resources/lambdas/stack-helpers-lambda';
import type { StackHelpersResourceProperties } from './runtime/stack-helpers/resource-properties';
import { applyServerlessInboxComponentTag }    from './tagging/serverless-inbox-tags';
import { getOrCreateSharedGroup }              from './tagging/shared-group';

/**
 * What a seeded number is derived from and how large it may be.
 */
export interface StackHelpersSeededNumberProps {
  /** Gives each purpose its own number within one stack; the same salt in one stack yields the same number. */
  readonly salt: string;
  /** The number is in `[0, range)`. A positive integer. */
  readonly range: number;
}

/**
 * Singleton construct for domain name and S3-safe stack name derivation.
 * One shared lookup/sanitization Lambda per Stack; each resolver call attaches its own
 * `Custom::StackHelpers` custom resource.
 */
export class StackHelpers extends Construct {
  private readonly helperLambda: StackHelpersLambda;

  private constructor(scope: Construct, id: string, artifactResolver: IArtifactResolver) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ops');

    this.helperLambda = new StackHelpersLambda(this, 'handler', { artifactResolver });
  }

  /** One instance per stack, placed under the stack's shared group. */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): StackHelpers {
    const stack       = cdk.Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing    = sharedGroup.node.tryFindChild('stack-helpers');
    if (existing) {
      // cast: the id 'stack-helpers' under the shared group is only created by the line below.
      return existing as StackHelpers;
    }
    return new StackHelpers(sharedGroup, 'stack-helpers', artifactResolver);
  }

  /**
   * Attaches the caller's own custom resource under `scope`; the result is a deploy-time token: the
   * name of the hosted zone without its trailing dot, empty when `hostedZoneId` is empty.
   */
  resolveHostedZoneName(scope: Construct, id: string, hostedZoneId: string): string {
    const customResource = this.attach(scope, id, { HostedZoneId: hostedZoneId });
    return customResource.getAttString('domainName');
  }

  /** Attaches the caller's own custom resource under `scope`; the result is a deploy-time token. */
  resolveS3SafeStackName(scope: Construct, id: string, stackName: string): string {
    const customResource = this.attach(scope, id, { DataStackName: stackName });
    return customResource.getAttString('s3SafeDataStackName');
  }

  /**
   * Attaches the caller's own custom resource under `scope`; the result is a deploy-time token. The
   * prefix is derived from `domainName` with no Route 53 call, and falls back to the stack name when
   * `domainName` leaves nothing usable.
   */
  resolveCognitoDomainPrefix(scope: Construct, id: string, domainName: string): string {
    const customResource = this.attach(scope, id, {
      DomainName: domainName,
      Fallback:   cdk.Aws.STACK_NAME,
    });
    return customResource.getAttString('cognitoDomainPrefix');
  }

  /**
   * Attaches the caller's own custom resource under `scope`; the result is a deploy-time token. The
   * number differs between installs and stays the same across updates of one stack.
   */
  resolveSeededNumber(scope: Construct, id: string, props: StackHelpersSeededNumberProps): string {
    const customResource = this.attach(scope, id, {
      Salt:  props.salt,
      Range: props.range.toString(),
    });
    return customResource.getAttString('seededNumber');
  }

  private attach(
    scope: Construct,
    id: string,
    properties: StackHelpersResourceProperties,
  ): cdk.CustomResource {
    return new cdk.CustomResource(scope, id, {
      serviceToken:   this.helperLambda.functionArn,
      serviceTimeout: cdk.Duration.seconds(90),
      resourceType:   'Custom::StackHelpers',
      properties,
    });
  }
}
