export type ApiGatewayV2EventLike = {
  rawPath?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  requestContext: {
    requestId?: string;
    http?: {
      method?: string;
      path?: string;
    };
    authorizer?: {
      lambda?: unknown;
      jwt?: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ApiGatewayV2ResultLike = {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
};

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
