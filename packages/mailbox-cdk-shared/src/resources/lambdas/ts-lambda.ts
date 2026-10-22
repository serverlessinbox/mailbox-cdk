import { Runtime }                  from 'aws-cdk-lib/aws-lambda';
import type { Construct }           from 'constructs';

import { ArtifactLambda }           from './artifact-lambda';
import type { ArtifactLambdaProps } from './artifact-lambda';

/** What `TypeScriptLambda` needs beyond the function options: which published artifact holds the code, and which pipeline the function logs under. */
export interface TypeScriptLambdaProps extends Omit<ArtifactLambdaProps, 'runtime' | 'handler'> {
  /**
   * Lambda entry point handler (defaults to 'index.handler')
   */
  readonly handler?: string;
}

/**
 * A Node.js Lambda on ARM64 whose code is a published artifact, resolved through the artifact resolver
 * from `lambdas/<lambdaId>.zip` of the package named by `packageName`. It logs to the shared log group
 * of its pipeline unless `logGroup` is passed, and carries `SERVICE_NAME` and the artifact tags.
 */
export class TypeScriptLambda extends ArtifactLambda {
  constructor(scope: Construct, id: string, props: TypeScriptLambdaProps) {
    super(scope, id, {
      memorySize: 512,
      ...props,
      runtime: Runtime.NODEJS_24_X,
      handler: props.handler ?? 'index.handler',
    });
  }
}
