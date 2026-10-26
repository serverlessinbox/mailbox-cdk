import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

/**
 * The JMAP API URL the MCP Lambda points at, the OAuth scope map it applies and the artifact resolver
 * for its code.
 */
export interface McpApiLambdaProps {
  readonly jmapApiUrl:       string;
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
        JMAP_API_URL:    props.jmapApiUrl,
        OAUTH_SCOPE_MAP: JSON.stringify(props.scopeMap),
      },
    });
  }
}
