/**
 * The fields of an API Gateway HTTP API (payload format 2.0) invocation event that the admin API reads.
 * Every other field of the event is carried along untyped.
 */
export type ApiGatewayV2EventLike = {
  [key: string]: unknown;
  rawPath?:       string;
  body?:          string | null;
  headers?:       Record<string, string | undefined>;
  requestContext: {
    [key: string]: unknown;
    requestId?:  string;
    http?:       {
      method?: string;
      path?:   string;
    };
    authorizer?: {
      lambda?: unknown;
      jwt?:    unknown;
    };
  };
};

/** The response shape API Gateway HTTP APIs (payload format 2.0) accept from a Lambda. */
export type ApiGatewayV2ResultLike = {
  statusCode:       number;
  headers?:         Record<string, string>;
  body?:            string;
  isBase64Encoded?: boolean;
};
