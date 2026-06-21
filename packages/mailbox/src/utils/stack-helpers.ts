import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { TypeScriptLambda } from './ts-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';

export interface StackHelpersProps {
  readonly artifactResolver: ICdkArtifactResolver;
  readonly hostedZoneId: string;
  readonly dataStackName: string;
}

export class StackHelpers extends Construct {
  /** CloudFormation token: zone apex without trailing dot (e.g. "example.com") */
  public readonly derivedDomainName: string;
  /** CloudFormation token: zone name with trailing dot (e.g. "example.com.") */
  public readonly derivedZoneName: string;
  /** CloudFormation token: sanitized data stack name for S3 bucket names (max 40 chars) */
  public readonly derivedS3SafeDataStackName: string;

  constructor(scope: Construct, id: string, props: StackHelpersProps) {
    super(scope, id);

    const fn = new TypeScriptLambda(this, 'handler', {
      lambdaId: 'stack-helpers',
      artifactResolver: props.artifactResolver,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['route53:GetHostedZone', 'route53:ListHostedZones'],
      resources: ['*'],
    }));

    const cr = new cdk.CfnCustomResource(this, 'resource', {
      serviceToken: fn.functionArn,
    });
    cr.addPropertyOverride('HostedZoneId', props.hostedZoneId);
    cr.addPropertyOverride('DataStackName', props.dataStackName);

    this.derivedDomainName          = cdk.Fn.getAtt(cr.logicalId, 'domainName').toString();
    this.derivedZoneName            = cdk.Fn.getAtt(cr.logicalId, 'zoneName').toString();
    this.derivedS3SafeDataStackName = cdk.Fn.getAtt(cr.logicalId, 's3SafeDataStackName').toString();
  }
}
