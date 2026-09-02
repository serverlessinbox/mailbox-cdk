import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { TypeScriptLambda, CdkArtifactEngine, getOrCreateSharedGroup } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '../artifacts/i-artifact-resolver';
import { applyServerlessInboxComponentTag } from './serverless-inbox-tags';

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
  private readonly fn: TypeScriptLambda;

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

    // Whichever caller's resolver wins the race, it MUST know about 'mailbox-cdk' — this construct's
    // own Lambda lives there regardless of who constructed the singleton first. Idempotent (Set-backed).
    artifactResolver.registerPackages(['mailbox-cdk']);
    const cdkArtifactResolver = new CdkArtifactEngine(this, artifactResolver);

    this.fn = new TypeScriptLambda(this, 'handler', {
      lambdaId: 'stack-helpers',
      pipeline: 'infra',
      artifactResolver: cdkArtifactResolver,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    this.fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['route53:GetHostedZone', 'route53:ListHostedZones'],
      resources: ['*'],
    }));
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
