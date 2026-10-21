import type { APIGatewayProxyStructuredResultV2 }                                                    from 'aws-lambda';

import type { ClientRegistrationError, ClientRegistrationErrorResponse, ClientRegistrationResponse } from './dcr.validation';

/** The HTTP statuses with which a registration is rejected. */
export type RejectionStatus = 400 | 409 | 429 | 500;

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
