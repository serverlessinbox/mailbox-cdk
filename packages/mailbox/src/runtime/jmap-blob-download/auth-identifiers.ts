import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The audience of a token; empty when the token names none. A string of its own kind so that it cannot be
 * passed where another identifier is expected; `toAudience` holds the only cast to the brand.
 */
export type Audience = Branded<'Audience'>;

export function toAudience(raw: string): Audience {
  return raw as Audience;
}

/**
 * The issuer and audience of a session token issued to a personal access token. A session token that carries
 * any other identity is not a personal access token session.
 */
export const PAT_SESSION_IDENTITY = 'pat';
