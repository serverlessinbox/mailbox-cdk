import type { IArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda, StackDeployedEvent }  from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                     from 'constructs';

import { AuthKeyRefreshSchedule }        from '../events/auth-key-refresh-schedule';
import type { IAuthKeyStoreTable }       from '../tables/auth-key-store-table';

/**
 * The issuers whose keys are refreshed, the key store table they are written to and the artifact
 * resolver for the function's code. The caller creates the table.
 */
export interface AuthKeyStoreUpdaterLambdaProps {
  readonly issuers:           string[];
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly artifactResolver:  IArtifactResolver;
}

/**
 * Refreshes the auth key store on a schedule and after each stack deployment. It does not own the
 * key store table.
 */
export class AuthKeyStoreUpdaterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuthKeyStoreUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId:         'auth-key-store-updater',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      memorySize:       128,
      environment:      {
        ISSUERS:                   props.issuers.join(','),
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
      },
    });

    // This Lambda writes the current (and rotating previous) HMAC key and JWKS entries.
    props.authKeyStoreTable.grantReadWrite(this);

    new AuthKeyRefreshSchedule(this, 'refresh-schedule', { target: this });
    new StackDeployedEvent(this, 'stack-deployed', this);
  }
}
