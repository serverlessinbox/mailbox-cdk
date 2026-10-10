import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { getOrCreateSharedGroup } from './shared-group';
import { applyServerlessInboxComponentTag } from './serverless-inbox-tags';
import { StackHelpersLambda } from './stack-helpers-lambda';

export interface StackHelpersMailboxDataProps {
  readonly hostedZoneId: string;
  readonly dataStackName: string;
}

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

  /**
   * Get-or-create the one shared lookup/sanitization Lambda for this Stack.
   * The singleton is placed under a "shared" group construct at stack root.
   */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): StackHelpers {
    const stack = cdk.Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing = sharedGroup.node.tryFindChild('stack-helpers');
    if (existing) {
      return existing as StackHelpers;
    }
    return new StackHelpers(sharedGroup, 'stack-helpers', artifactResolver);
  }

  private constructor(scope: Construct, id: string, artifactResolver: IArtifactResolver) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'ops');

    this.fn = new StackHelpersLambda(this, 'handler', { artifactResolver });
  }

  /**
   * Attaches the caller's OWN custom resource for domain-name + S3-safe-stack-name derivation.
   * Returns CloudFormation tokens for the derived values.
   */
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

  /**
   * Attaches the caller's OWN custom resource for the sanitized Cognito domain prefix.
   * Returns a CloudFormation token for the derived prefix.
   */
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
    properties: Record<string, string>,
  ): cdk.CustomResource {
    return new cdk.CustomResource(scope, id, {
      serviceToken: this.fn.functionArn,
      serviceTimeout: cdk.Duration.seconds(120),
      resourceType: 'Custom::StackHelpers',
      properties,
    });
  }
}
