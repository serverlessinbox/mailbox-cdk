/** The HTTP method and path of the request, as the event's request context carries them. */
type ApiGatewayV2Http = {
  method?: string;
  path?:   string;
};

/** The authorizer output of the request, as the event's request context carries it. */
type ApiGatewayV2Authorizer = {
  lambda?: unknown;
  jwt?:    unknown;
};

/** The request context fields of the event that the admin API reads. Every other field is carried along untyped. */
type ApiGatewayV2RequestContext = {
  [key: string]: unknown;
  requestId?:  string;
  http?:       ApiGatewayV2Http;
  authorizer?: ApiGatewayV2Authorizer;
};

/**
 * The fields of an API Gateway HTTP API (payload format 2.0) invocation event that the admin API reads.
 * Every other field of the event is carried along untyped.
 */
export type ApiGatewayV2EventLike = {
  [key: string]: unknown;
  rawPath?:       string;
  body?:          string | null;
  headers?:       Record<string, string | undefined>;
  requestContext: ApiGatewayV2RequestContext;
};

/** The response shape API Gateway HTTP APIs (payload format 2.0) accept from a Lambda. */
export type ApiGatewayV2ResultLike = {
  statusCode:       number;
  headers?:         Record<string, string>;
  body?:            string;
  isBase64Encoded?: boolean;
};
