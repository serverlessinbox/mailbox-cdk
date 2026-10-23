import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import * as apigwv2               from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

/**
 * The JMAP API gateway the MCP Lambda points at, the OAuth scope map it applies and the artifact resolver
 * for its code. The caller creates the gateway.
 */
export interface McpApiLambdaProps {
  readonly jmapApiGateway:   apigwv2.IHttpApi;
  readonly scopeMap:         Record<string, string[]>;
  readonly artifactResolver: IArtifactResolver;
}

/** The Go Lambda behind the MCP endpoint. It is configured with the JMAP API endpoint and the scope map. */
export class McpApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: McpApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'mcp-api',
      pipeline:         'jmap',
      artifactResolver: props.artifactResolver,
      memorySize:       256,
      timeout:          Duration.seconds(29),
      environment:      {
        JMAP_API_URL:    props.jmapApiGateway.apiEndpoint,
        OAUTH_SCOPE_MAP: JSON.stringify(props.scopeMap),
      },
    });
  }
}
