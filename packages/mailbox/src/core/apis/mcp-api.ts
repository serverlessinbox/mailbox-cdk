import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }   from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaAuthorizer }   from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration }  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import * as acm                          from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda                       from 'aws-cdk-lib/aws-lambda';
import { Aws }                           from 'aws-cdk-lib';
import { Construct }                     from 'constructs';

import { McpApiLambda }                  from '../../resources/lambdas/mcp-api-lambda';
import type { ScopeMap }                 from '../auth/jmap-scopes';

import { ApiCustomDomain }               from './api-custom-domain';

/** Inputs of {@link McpApi}: the JMAP API it fronts, the authorizer and certificate it reuses, and its domain. */
export interface McpApiProps {
  /** The JMAP API's custom-domain URL, `https://<domain>`; handed to the MCP handler Lambda. */
  readonly jmapApiUrl: string;
  /** Authorizer Lambda that protects every MCP route. */
  readonly authorizerLambda: lambda.IFunction;
  /** Regional ACM certificate that covers the MCP host, in the same region as the API. */
  readonly certificate: acm.ICertificate;
  /** The MCP host the API is served on, e.g. mcp.example.com or, with a namespace, mcp.mail.example.com. */
  readonly host:     string;
  readonly scopeMap: ScopeMap;
  /** Artifact resolver for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
}

/**
 * The MCP (Model Context Protocol) HTTP API: one proxy route to the MCP handler Lambda behind a
 * Lambda authorizer, served on the custom domain it is given as `host`.
 *
 * It does not create the DNS record for that domain (it exposes `domainTarget` for that), and it
 * does not create the authorizer or the certificate it is given.
 */
export class McpApi extends Construct {
  /** CNAME target to publish (API Gateway regional domain) for the MCP host. */
  public readonly domainTarget: string;

  constructor(scope: Construct, id: string, props: McpApiProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Model Context Protocol (MCP) endpoint exposing mailbox tools to AI clients.');

    const api          = new HttpApi(this, 'mcp-api', {
      apiName:                   `Mailbox ${Aws.STACK_NAME} MCP API`,
      createDefaultStage:        false,
      description:               'This service serves MCP (Model Context Protocol) endpoints.',
      disableExecuteApiEndpoint: true,
    });
    const defaultStage = api.addStage('DefaultStage', {
      autoDeploy: true,
      throttle:   { rateLimit: 100, burstLimit: 200 },
    });

    const domain = new ApiCustomDomain(this, 'domain', {
      domainName:  props.host,
      certificate: props.certificate,
    });

    this.domainTarget = domain.regionalDomainName;

    new ApiMapping(this, 'mapping', {
      api,
      domainName: domain,
      stage:      defaultStage,
    });

    const handlerLambda = new McpApiLambda(this, 'handler', {
      jmapApiUrl:       props.jmapApiUrl,
      scopeMap:         props.scopeMap,
      artifactResolver: props.artifactResolver,
    });

    const httpLambdaAuthorize = new HttpLambdaAuthorizer('authorizer', props.authorizerLambda);

    const httpLambdaIntegration = new HttpLambdaIntegration('handler', handlerLambda);

    api.addRoutes({
      path:        '/{proxy+}',
      methods:     [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE, HttpMethod.PUT],
      authorizer:  httpLambdaAuthorize,
      integration: httpLambdaIntegration,
    });
  }
}
