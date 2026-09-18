import { Construct } from 'constructs';
import {
  ApiMapping,
  DomainName,
  EndpointType,
  HttpApi,
  HttpMethod,
  SecurityPolicy,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpLambdaAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Aws } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { McpApiLambda } from '../../lambdas/mcp-api';

export interface McpApiProps {
  jmapApiGateway: apigwv2.IHttpApi;
  authorizerLambda: lambda.IFunction;
  certificate: acm.ICertificate;
  domainName: string;
  scopeMap: Record<string, string[]>;
  /** Artifact resolver for Lambda code resolution. */
  artifactResolver: ICdkArtifactEngine;
}

export class McpApi extends Construct {
  public readonly domainTarget: string;

  constructor(scope: Construct, id: string, props: McpApiProps) {
    super(scope, id);

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
