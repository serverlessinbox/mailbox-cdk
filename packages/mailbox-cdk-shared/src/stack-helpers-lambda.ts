import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import * as iam                   from 'aws-cdk-lib/aws-iam';
import * as cdk                   from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { TypeScriptLambda }       from './ts-lambda';

/** The artifact resolver the stack-helpers Lambda's code is loaded through. */
export interface StackHelpersLambdaProps {
  readonly artifactResolver: IArtifactResolver;
}

/** The Lambda behind `Custom::StackHelpers` resources. */
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
    this.addToRolePolicy(new iam.PolicyStatement({
      actions: ['route53:GetHostedZone'],
      resources: ['*'],
    }));
  }
}
