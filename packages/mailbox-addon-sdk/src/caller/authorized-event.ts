import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';

/** An API Gateway HTTP API (payload format 2.0) event that went through a Lambda authorizer. */
export type AuthorizedEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<unknown>;
