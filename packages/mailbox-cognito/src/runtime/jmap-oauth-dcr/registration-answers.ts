import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

/** The HTTP statuses with which a registration is rejected. */
export type RejectionStatus = 400 | 409 | 429 | 500;

/** RFC 7591 §3.2.1 successful client information response: the fields this Lambda writes. */
export interface ClientRegistrationResponse {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly redirect_uris: string[];
  readonly token_endpoint_auth_method: 'none';
  readonly client_name: string;
  readonly scope: string;
}

/**
 * The error codes of a registration answer. RFC 7591 §3.2.2 defines `invalid_redirect_uri` and
 * `invalid_client_metadata` (with `invalid_software_statement` and `unapproved_software_statement`, which are
 * never answered here); `server_error` is the RFC 6749 §5.2 code, for a failure that is not a fault in the
 * submitted metadata. Answering one of those as `invalid_client_metadata` would invite the client to "fix" a
 * request that was correct.
 */
export type ClientRegistrationError = 'invalid_redirect_uri' | 'invalid_client_metadata' | 'server_error';

/** RFC 7591 §3.2.2 client registration error response. */
export interface ClientRegistrationErrorResponse {
  readonly error: ClientRegistrationError;
  readonly error_description?: string;
}

/** Builds the HTTP answers of the registration endpoint, so that every one of them is JSON and uncacheable. */
export class RegistrationAnswers {
  public static created(response: ClientRegistrationResponse): APIGatewayProxyStructuredResultV2 {
    return RegistrationAnswers.json(201, response);
  }

  public static rejected(statusCode: RejectionStatus, error: ClientRegistrationError, description?: string): APIGatewayProxyStructuredResultV2 {
    const body: ClientRegistrationErrorResponse = {
      error,
      ...(description ? { error_description: description } : {}),
    };
    return RegistrationAnswers.json(statusCode, body);
  }

  public static internalError(): APIGatewayProxyStructuredResultV2 {
    return RegistrationAnswers.rejected(500, 'server_error', 'Internal error processing registration');
  }

  private static json(statusCode: 201 | RejectionStatus, body: ClientRegistrationResponse | ClientRegistrationErrorResponse): APIGatewayProxyStructuredResultV2 {
    return {
      statusCode,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        pragma: 'no-cache',
      },
      body: JSON.stringify(body),
    };
  }
}
