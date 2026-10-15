import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifier the JMAP blob download function passes between the verifiers that read a token and the authorizer that
 * compares them, a string of its own kind so that it cannot be passed where another identifier is expected.
 * The kind has exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The audience of a token; empty when the token names none. */
export type Audience = Branded<'Audience'>;

export function toAudience(raw: string): Audience {
  return raw as Audience;
}
