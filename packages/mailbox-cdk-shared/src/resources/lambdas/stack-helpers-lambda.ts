import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import * as iam                   from 'aws-cdk-lib/aws-iam';
import * as cdk                   from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { KIT_ARTIFACT_PACKAGE }   from '../../artifacts/kit-artifact-package';

import { TypeScriptLambda }       from './ts-lambda';

/** The artifact resolver the stack-helpers Lambda's code is loaded through. */
export interface StackHelpersLambdaProps {
  readonly artifactResolver: IArtifactResolver;
}

/** The Lambda behind `Custom::StackHelpers` resources. */
export class StackHelpersLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: StackHelpersLambdaProps) {
    super(scope, id, {
      lambdaId:         'stack-helpers',
      packageName:      KIT_ARTIFACT_PACKAGE,
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      timeout:          cdk.Duration.seconds(30),
      memorySize:       256,
    });
  }

  /** Lets the Lambda read the one hosted zone a resolver call names. */
  public grantHostedZoneRead(hostedZoneId: string): void {
    this.addToRolePolicy(new iam.PolicyStatement({
      actions:   ['route53:GetHostedZone'],
      resources: [`arn:${cdk.Aws.PARTITION}:route53:::hostedzone/${hostedZoneId}`],
    }));
  }
}
