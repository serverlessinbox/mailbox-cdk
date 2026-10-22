import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * A blob id as it arrives in the download query: the decoded id in unpadded base64url. A string of its own
 * kind so that it cannot be passed where another form of the id is expected; `toEncodedBlobId` holds the only
 * cast to the brand.
 */
export type EncodedBlobId = Branded<'EncodedBlobId'>;

/**
 * A blob id after base64url decoding: `eml:{emailId}:{path}:{mac}`, `cnt:{cardId}:{path}` or
 * `prn:{principalId}:{path}`. A string of its own kind; `toDecodedBlobId` holds the only cast to the brand.
 */
export type DecodedBlobId = Branded<'DecodedBlobId'>;

/** A parsed email blob id; its `mac` is `null` when the id was issued without one, which the authorizer refuses. */
export interface EmailBlob {
  readonly type:     'email';
  readonly entityId: string;
  readonly path:     string;
  readonly mac:      string | null;
}

/** A parsed contact blob id. */
export interface ContactBlob {
  readonly type:     'contact';
  readonly entityId: string;
  readonly path:     string;
}

/** A parsed principal blob id. */
export interface PrincipalBlob {
  readonly type:     'principal';
  readonly entityId: string;
  readonly path:     string;
}

/** A decoded blob id split into the parts the authorizer acts on. Only an email blob carries a MAC. */
export type ParsedBlobId = EmailBlob | ContactBlob | PrincipalBlob;

export function toEncodedBlobId(raw: string): EncodedBlobId {
  return raw as EncodedBlobId;
}

export function toDecodedBlobId(raw: string): DecodedBlobId {
  return raw as DecodedBlobId;
}
