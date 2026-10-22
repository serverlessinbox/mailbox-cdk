import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * What a reader of the template-version parameter needs: the parameter name (for a Lambda's env var)
 * and a read grant.
 */
export interface ITemplateVersionParam {
  readonly parameterName: string;

  grantRead(grantee: IGrantable): void;
}
