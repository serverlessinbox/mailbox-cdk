import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { TypeScriptLambda } from './ts-lambda';
import type { ICdkArtifactEngine } from './artifact-engine';

export interface StackHelpersLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * The shared domain-name / S3-safe-stack-name / Cognito-domain-prefix derivation Lambda backing
 * `StackHelpers`'s `Custom::StackHelpers` resources.
 */
export class StackHelpersLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: StackHelpersLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-helpers',
      packageName: 'mailbox-cdk-shared',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    this.grantRoute53HostedZoneRead();
  }

  private grantRoute53HostedZoneRead(): void {
    // Route53 exposes no condition keys on any resource type, and hosted zones are
    // customer-arbitrary at runtime — no ARN/tag scoping is possible here.
    this.addToRolePolicy(new iam.PolicyStatement({
      actions: ['route53:GetHostedZone', 'route53:ListHostedZones'],
      resources: ['*'],
    }));
  }
}
