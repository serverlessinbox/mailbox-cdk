/**
 * Sanitize stack name for valid AWS resource naming
 *
 * S3 bucket names must:
 * - Be 3-63 characters long
 * - Contain only lowercase letters, numbers, hyphens
 * - Start and end with letter or number
 *
 * DynamoDB table names must:
 * - Contain only alphanumeric characters, hyphens, underscores, periods
 *
 * This function sanitizes for S3 compatibility (stricter constraints)
 */
export function sanitizeStackName(stackName: string): string {
  return stackName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // Replace invalid chars with hyphens
    .replace(/-+/g, '-')             // Collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');        // Remove leading/trailing hyphens
}
