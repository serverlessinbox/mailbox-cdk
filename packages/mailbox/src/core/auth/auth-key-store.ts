import type { IArtifactResolver }                from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription }                  from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                             from 'constructs';

import { AuthKeyStoreUpdaterLambda }             from '../../resources/lambdas/auth-key-store-updater-lambda';
import { AuthKeyStoreTable, IAuthKeyStoreTable } from '../../resources/tables/auth-key-store-table';

/** Inputs of {@link AuthKeyStore}: the OIDC issuers whose signing keys are stored. */
export interface AuthKeyStoreProps {
  readonly issuers:          string[];
  readonly artifactResolver: IArtifactResolver;
}

/**
 * The table of OIDC signing keys (JWKS) together with the Lambda that fills it from the given
 * issuers. It does not validate tokens itself; it only stores the keys that validation reads.
 */
export class AuthKeyStore extends Construct {
  public readonly authKeyStoreTable: IAuthKeyStoreTable;

  constructor(scope: Construct, id: string, props: AuthKeyStoreProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Stores OIDC signing keys (JWKS) in DynamoDB for the Lambda@Edge authorizer to validate JWTs at the CDN edge.');

    const authKeyStoreTable = new AuthKeyStoreTable(this, 'table');

    new AuthKeyStoreUpdaterLambda(this, 'handler', {
      authKeyStoreTable,
      issuers:          props.issuers,
      artifactResolver: props.artifactResolver,
    });

    this.authKeyStoreTable = authKeyStoreTable;
  }
}
