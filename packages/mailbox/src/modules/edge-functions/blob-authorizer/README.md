# Blob Authorizer Lambda@Edge Function

This Lambda@Edge function authorizes downloads of email blobs (attachments, body parts) from CloudFront CDN.

## Architecture

The function is organized into multiple modules for maintainability:

### Files

- **`index.ts`** - Main handler and request orchestration
- **`config.ts`** - Configuration extraction from CloudFront custom headers
- **`jwt.ts`** - JWT token verification using JWKS from DynamoDB
- **`dynamodb.ts`** - DynamoDB queries for email entities
- **`utils.ts`** - Utility functions for parsing and response formatting

## Flow

1. Extract configuration from custom origin headers (Lambda@Edge doesn't support environment variables)
2. Extract JMAP parameters: `accountId`, `blobId`, `type`, `name`
3. Parse `blobId` to get `emailID` and `path` (format: `emailID:path`)
4. Verify JWT token and extract user context (`userId`, `accountIds`)
5. Verify requested `accountId` is in user's allowed account list
6. Query DynamoDB to get email entity
7. Verify user owns the email (`userId` match)
8. Verify email belongs to requested account (`accountId` match)
9. Construct S3 key and add content headers (`Content-Type`, `Content-Disposition`)
10. Forward modified request to S3 origin

## Configuration

Configuration is passed via CloudFront custom origin headers:

- `x-table-name` - DynamoDB item table name
- `x-jwk-cache-table` - DynamoDB JWK cache table name
- `x-region` - AWS region for DynamoDB
- `x-issuer` - Cognito User Pool issuer URL

## JWT Verification

- Uses `jsonwebtoken` library with RS256 algorithm
- Fetches JWKS from DynamoDB (cached by jwk-dynamo-cache-updater Lambda)
- In-memory caching of JWKS for warm Lambda invocations
- Converts JWK to PEM format for verification
- Validates issuer, expiration, and signature

## Security

- **JWT token required** via Authorization header
- **Account verification**: Requested accountId must be in user's token
- **User ownership**: User must own the email to access its blobs
- **Account consistency**: Email's accountId must match requested accountId
- **CloudFront caching**: Responses cached at edge (origin-request event type)
- **Custom headers**: Only visible to Lambda@Edge, not end users

### Multi-layered Authorization

1. **Token validation**: JWT signature, issuer, expiration
2. **Account access**: User has access to requested account
3. **Email ownership**: User owns the email
4. **Account consistency**: Email belongs to requested account

## Request Format (JMAP Spec Compliant)

Following RFC 8620, the download URL accepts these parameters:

- **`accountId`** (required) - The account ID that owns the blob
- **`blobId`** (required) - The blob identifier (format: `emailID:path`)
- **`type`** (optional) - Content-Type/MIME type for the blob
- **`name`** (optional) - Filename for Content-Disposition header

```
GET https://{cloudfront-domain}/download?accountId={accountId}&blobId={emailID}:{path}&type={mimeType}&name={filename}
Authorization: Bearer {jwt-token}
```

### Example

```
GET https://d1234.cloudfront.net/download?accountId=acc_123&blobId=email_abc123:body.txt&type=text%2Fplain&name=message.txt
Authorization: Bearer eyJhbGc...
```

## Response

- **Success**: Modified request forwarded to S3 origin
- **Error**: JSON error response with appropriate HTTP status code

## Dependencies

- `@aws-sdk/client-dynamodb` - DynamoDB client
- `@aws-sdk/util-dynamodb` - DynamoDB utilities
- `jsonwebtoken` - JWT verification
- `crypto` - JWK to PEM conversion
