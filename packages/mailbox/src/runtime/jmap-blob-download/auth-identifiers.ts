import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The audience of a token; empty when the token names none. A string of its own kind so that it cannot be
 * passed where another identifier is expected; `toAudience` holds the only cast to the brand.
 */
export type Audience = Branded<'Audience'>;

export function toAudience(raw: string): Audience {
  return raw as Audience;
}
