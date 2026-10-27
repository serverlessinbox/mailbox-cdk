import { ComponentDescription }                                    from '@serverlessinbox/mailbox-cdk-shared';
import { HttpLambdaIntegration }                                   from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  ApiMapping,
  CorsHttpMethod,
  HttpApi,
  IHttpStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import type { CorsPreflightOptions }                               from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration, Aws }                                           from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IApiArea }                                           from './api-area';
import { ApiCustomDomain }                                         from './api-custom-domain';
import type { ApiCustomDomainProps, ILogicalIdPin }                from './api-custom-domain';

/** Inputs of {@link ApiGateway}: the origins its CORS preflight allows and the optional custom domain. */
export interface ApiGatewayProps {
  /** Origins allowed by the API's CORS preflight. Without any, no CORS configuration is created. */
  readonly allowedOrigins?: string[];

  /** Optional custom domain (e.g. api.example.com) to serve the API on. */
  readonly customDomain?: ApiCustomDomainProps;
}

/**
 * The shared HTTP API the admin and user areas mount their routes on. It owns the HTTP API, its default
 * stage, the custom domain, the API mapping and the CORS preflight, and nothing else: it creates no Lambda,
 * authorizer or route of its own.
 *
 * It does not create the DNS record for the custom domain (it exposes `domainTarget` for that).
 */
export class ApiGateway extends Construct {
  /** The API's base URL: `https://<domainName>` with a custom domain, the API Gateway endpoint otherwise. */
  public readonly url: string;
  /** CNAME target to publish (API Gateway regional domain) when custom domain is enabled. */
  public readonly domainTarget?: string;
  /** Fixes the logical id of the custom domain name. Present only when a custom domain is set. */
  public readonly domainLogicalIdPin?: ILogicalIdPin;
  private readonly api: HttpApi;
  private readonly defaultStage: IHttpStage;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Shared HTTP API that serves the admin and user API endpoints.');

    this.api          = new HttpApi(this, 'admin-api', {
      apiName:            `Mailbox ${Aws.STACK_NAME} API`,
      createDefaultStage: false,
      description:        'This service serves the mailbox admin and user API endpoints.',
      corsPreflight:      this.corsPreflight(props.allowedOrigins),
      ...(props.customDomain ? { disableExecuteApiEndpoint: true } : {}),
    });
    this.defaultStage = this.api.addStage('DefaultStage', {
      autoDeploy: true,
      throttle:   { rateLimit: 100, burstLimit: 200 },
    });

    if (props.customDomain) {
      const domain = this.addCustomDomain(props.customDomain);

      this.url                = `https://${props.customDomain.domainName}`;
      this.domainTarget       = domain.regionalDomainName;
      this.domainLogicalIdPin = domain.logicalIdPin;
    } else {
      this.url = this.api.apiEndpoint;
    }
  }

  /** Adds every route of `area` to the shared HTTP API, each with its integration and authorizer. */
  public mount(area: IApiArea): void {
    for (const route of area.routes) {
      this.api.addRoutes({
        path:        route.path,
        methods:     route.methods,
        integration: new HttpLambdaIntegration(route.integrationId, route.handler),
        authorizer:  route.authorizer,
      });
    }
  }

  private corsPreflight(allowedOrigins: string[] | undefined): CorsPreflightOptions | undefined {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return undefined;
    }

    return {
      allowOrigins:     allowedOrigins,
      allowMethods:     [CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
      allowHeaders:     ['Content-Type', 'Authorization'],
      allowCredentials: true,
      maxAge:           Duration.hours(1),
    };
  }

  private addCustomDomain(customDomain: ApiCustomDomainProps): ApiCustomDomain {
    const domain = new ApiCustomDomain(this, 'domain', customDomain);

    new ApiMapping(this, 'mapping', {
      api:        this.api,
      domainName: domain,
      stage:      this.defaultStage,
    });

    return domain;
  }
}
