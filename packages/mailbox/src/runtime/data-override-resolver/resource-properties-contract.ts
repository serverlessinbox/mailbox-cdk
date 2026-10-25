/** The custom-resource properties of the data override resolver, one incoming and one override ARN per table role. */
export interface ResourceProperties {
  readonly configTableIncomingArn:       string;
  readonly configTableOverrideArn:       string;
  readonly itemTableIncomingArn:         string;
  readonly itemTableOverrideArn:         string;
  readonly changelogTableIncomingArn:    string;
  readonly changelogTableOverrideArn:    string;
  readonly auditLogTableIncomingArn:     string;
  readonly auditLogTableOverrideArn:     string;
  readonly mailFeedbackTableIncomingArn: string;
  readonly mailFeedbackTableOverrideArn: string;
}

/** The data tables whose ARN the resolver decides, by the role each plays in the mailbox. */
export type TableRole = 'configTable' | 'itemTable' | 'changelogTable' | 'auditLogTable' | 'mailFeedbackTable';
