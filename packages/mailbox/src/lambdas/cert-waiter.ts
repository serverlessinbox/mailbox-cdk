import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';

export interface CertWaiterLambdaProps {
  artifactResolver: IArtifactResolver;
}

export class CertWaiterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: CertWaiterLambdaProps) {
    super(scope, id, {
      lambdaId: 'cert-waiter',
      artifactResolver: props.artifactResolver,
      // Polls ACM every 15s for up to 10 minutes — needs generous timeout.
      // CFN custom resource timeout defaults to 1 hour, so Lambda timeout is the binding limit.
      timeout: Duration.minutes(12),
    });
  }
}
