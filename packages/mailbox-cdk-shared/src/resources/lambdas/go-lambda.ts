import { Runtime }                  from 'aws-cdk-lib/aws-lambda';
import type { Construct }           from 'constructs';

import { ArtifactLambda }           from './artifact-lambda';
import type { ArtifactLambdaProps } from './artifact-lambda';

/** What `GoLambda` needs beyond the function options: the artifact the code is published as, and which pipeline the function logs under. The package, runtime and handler are fixed by `GoLambda`. */
export type GoLambdaProps = Omit<ArtifactLambdaProps, 'packageName' | 'runtime' | 'handler'>;

/**
 * A Go Lambda on ARM64 whose code is a published artifact, resolved through the artifact resolver from
 * `lambdas/<lambdaId>.zip`. It logs to the shared log group of its pipeline unless `logGroup` is passed,
 * and carries `SERVICE_NAME` and the artifact tags.
 * @internal
 */
export class GoLambda extends ArtifactLambda {
  constructor(scope: Construct, id: string, props: GoLambdaProps) {
    super(scope, id, {
      memorySize: 640,
      ...props,
      packageName: 'mailbox-go',
      runtime:     Runtime.PROVIDED_AL2023,
      handler:     'bootstrap',
    });
  }
}
