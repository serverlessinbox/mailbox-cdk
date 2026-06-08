/**
 * SSM parameter paths for a deployed MailboxDataStack.
 *
 * Each property holds the SSM parameter path (not the value) — pass it to
 * `ssm.StringParameter.valueForStringParameter()` to obtain the runtime value.
 */
export interface MailboxDataStackRef {
  readonly configTableArnParam: string;
  readonly itemTableArnParam: string;
  readonly changelogTableArnParam: string;
  readonly auditLogTableArnParam: string;
  readonly mailFeedbackTableArnParam: string;
  readonly blobStoreArnParam: string;
}
