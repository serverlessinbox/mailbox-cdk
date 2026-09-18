import { Duration } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Construct } from 'constructs';

export interface McpApiLambdaProps {
  readonly jmapApiGateway: apigwv2.IHttpApi;
  readonly scopeMap: Record<string, string[]>;
  readonly artifactResolver: ICdkArtifactEngine;
}

export class McpApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: McpApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'mcp-api',
      pipeline: 'jmap',
      artifactResolver: props.artifactResolver,
      memorySize: 256,
      timeout: Duration.seconds(29),
      environment: {
        JMAP_API_URL: props.jmapApiGateway.apiEndpoint,
        OAUTH_SCOPE_MAP: JSON.stringify(props.scopeMap),
      },
    });
  }
}
