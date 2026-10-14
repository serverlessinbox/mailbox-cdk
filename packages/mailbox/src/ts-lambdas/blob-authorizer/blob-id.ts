import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The forms a blob id takes on its way through the authorizer, each a string of its own kind so that one form
 * cannot be passed where another is expected. Every form has exactly one factory, and the cast to the brand
 * sits in that factory and nowhere else.
 */

/** A blob id as it arrives in the download query: the decoded id in unpadded base64url. */
export type EncodedBlobId = Branded<'EncodedBlobId'>;

/** A blob id after base64url decoding: `eml:{emailId}:{path}:{mac}`, `cnt:{cardId}:{path}` or `prn:{principalId}:{path}`. */
export type DecodedBlobId = Branded<'DecodedBlobId'>;

export function toEncodedBlobId(raw: string): EncodedBlobId {
  return raw as EncodedBlobId;
}

export function toDecodedBlobId(raw: string): DecodedBlobId {
  return raw as DecodedBlobId;
}

/**
 * A decoded blob id split into the parts the authorizer acts on. Only an email blob carries a MAC; its `mac`
 * is `null` when the id was issued without one, which the authorizer refuses.
 */
export type ParsedBlobId =
  | { type: 'email'; entityId: string; path: string; mac: string | null }
  | { type: 'contact'; entityId: string; path: string }
  | { type: 'principal'; entityId: string; path: string };
