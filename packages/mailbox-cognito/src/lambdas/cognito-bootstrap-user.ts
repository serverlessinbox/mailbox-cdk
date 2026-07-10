import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { COGNITO_ARTIFACT_PACKAGE } from '../index';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';

export interface CognitoBootstrapUserLambdaProps {
  artifactResolver: ICdkArtifactEngine;
}

/**
 * Artifact-based TypeScript Lambda for Cognito bootstrap user custom resource.
 *
 * Expects an artifact at: `lambdas/cognito-bootstrap-user.zip`
 * with handler: `index.handler`.
 */
export class CognitoBootstrapUserLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoBootstrapUserLambdaProps) {
    super(scope, id, {
      lambdaId: 'cognito-bootstrap-user',
      artifactResolver: props.artifactResolver,
      packageName: COGNITO_ARTIFACT_PACKAGE,
      timeout: Duration.minutes(2),
      memorySize: 256,
    });
  }
}
