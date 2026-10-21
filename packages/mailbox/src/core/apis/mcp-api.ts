import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }   from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }   from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  IHttpApi,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm         from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda      from 'aws-cdk-lib/aws-lambda';
import { Aws }          from 'aws-cdk-lib';
import { Construct }    from 'constructs';

import { McpApiLambda } from '../../resources/lambdas/mcp-api-lambda';

/** Inputs of {@link McpApi}: the JMAP API it fronts, the authorizer and certificate it reuses, and its domain. */
export interface McpApiProps {
  /** The JMAP API this MCP API fronts; handed to the MCP handler Lambda. */
  readonly jmapApiGateway: IHttpApi;
  /** Authorizer Lambda that protects every MCP route. */
  readonly authorizerLambda: lambda.IFunction;
  /** Regional ACM certificate that covers `mcp.<domainName>`, in the same region as the API. */
  readonly certificate: acm.ICertificate;
  /** Base domain; the API is served on `mcp.<domainName>`. */
  readonly domainName: string;
  readonly scopeMap: Record<string, string[]>;
  /** Artifact resolver for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
}

/**
 * The MCP (Model Context Protocol) HTTP API: one proxy route to the MCP handler Lambda behind a
 * Lambda authorizer, served on a custom domain `mcp.<domainName>`.
 *
 * It does not create the DNS record for that domain (it exposes `domainTarget` for that), and it
 * does not create the authorizer or the certificate it is given.
 */
export class McpApi extends Construct {
  /** CNAME target to publish (API Gateway regional domain) for `mcp.<domainName>`. */
  public readonly domainTarget: string;

  constructor(scope: Construct, id: string, props: McpApiProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Model Context Protocol (MCP) endpoint exposing mailbox tools to AI clients.');

    const api = new HttpApi(this, 'mcp-api', {
      apiName: `Mailbox ${Aws.STACK_NAME} MCP API`,
      description: 'This service serves MCP (Model Context Protocol) endpoints.',
    });

    const mcpDomainName = `mcp.${props.domainName}`;

    const domain = new DomainName(this, 'domain', {
      domainName: mcpDomainName,
      certificate: props.certificate,
      endpointType: EndpointType.REGIONAL,
      securityPolicy: SecurityPolicy.TLS_1_2,
    });

    this.domainTarget = domain.regionalDomainName;

    // Be explicit: the domain must be deleted before the certificate.
    domain.node.addDependency(props.certificate);

    new ApiMapping(this, 'mapping', {
      api,
      domainName: domain,
      stage: api.defaultStage!,
    });

    const handlerLambda = new McpApiLambda(this, 'handler', {
      jmapApiGateway: props.jmapApiGateway,
      scopeMap: props.scopeMap,
      artifactResolver: props.artifactResolver,
    });

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', props.authorizerLambda);

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', handlerLambda);

    api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE, HttpMethod.PUT],
      authorizer: httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
  }
}
