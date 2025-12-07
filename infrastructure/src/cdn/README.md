# CDN Construct - Email Blob Downloads

This construct sets up CloudFront with Lambda@Edge for secure, authorized blob downloads.

Integrated into the main `MailboxStack`.

## Architecture

```
Client Request
    ↓
CloudFront Distribution
    ↓
Lambda@Edge (Viewer Request)
    ├─→ Parse blobId from query string
    ├─→ Extract emailID from blobId
    ├─→ Verify JWT token
    ├─→ Query DynamoDB for email
    ├─→ Verify user access
    └─→ Construct S3 key
    ↓
S3 Origin (Email Bucket)
    ↓
Response to Client
```

## Blob ID Format

Blob IDs use the format: `emailID:path`

**Examples:**
- `email_abc123:body.txt`
- `email_abc123:body.html`
- `email_abc123:0_photo.jpg`
- `email_abc123:original.eml`

## Request Format

```http
GET https://<distribution-domain>/download?blobId=email_abc123:body.txt
Authorization: Bearer <JWT-token>
```

## Lambda@Edge Function

Located in: `edge-functions/blob-authorizer/`

### Authorization Flow

1. **Extract blob ID** from query string parameter
2. **Parse blob ID** to get `emailID` and `path`
3. **Extract user ID** from JWT token in Authorization header
4. **Query DynamoDB GSI1** with `GSI1PK = EMAIL#{emailID}`
5. **Verify access** - check if `email.userId === userId`
6. **Construct S3 key**: `accounts/{accountID}/emails/{emailID}/{path}`
7. **Rewrite request** to S3 object path

### Environment Variables

- `TABLE_NAME` - DynamoDB table name (automatically set by CDK)
- `AWS_REGION` - AWS region (automatically set by Lambda)

## Deployment

The CDN stack is deployed as part of the main infrastructure:

```bash
cd packages/infrastructure
npm run build
cdk deploy CdnStack
```

## Cache Policy

- **Default TTL**: 24 hours
- **Max TTL**: 365 days
- **Min TTL**: 0 seconds
- **Headers**: Authorization (for user-specific caching)
- **Query Strings**: All (blobId parameter)
- **Compression**: Gzip + Brotli enabled

## Security

- ✅ JWT-based authorization
- ✅ DynamoDB access control verification
- ✅ HTTPS only (HTTP redirects to HTTPS)
- ✅ CloudFront access logs enabled
- ✅ Lambda@Edge logs to CloudWatch

## Monitoring

- CloudFront access logs → S3 bucket `mailbox-cdn-logs-{account}`
- Lambda@Edge logs → CloudWatch Logs (in us-east-1)

## Outputs

- `CdnDomainName` - CloudFront distribution domain name
- `DistributionId` - CloudFront distribution ID

## Future Enhancements

- [ ] Custom domain with SSL certificate
- [ ] Response caching optimization
- [ ] Signed URLs for temporary access
- [ ] Rate limiting
- [ ] DynamoDB DAX for faster queries
- [ ] Lambda@Edge in-memory caching
