import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface AuthKeyStoreUpdaterLambdaProps {
  issuers: string[];
  authKeyStoreTable: ITable;
  artifactResolver: ICdkArtifactResolver;
}

export class AuthKeyStoreUpdaterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuthKeyStoreUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId: 'auth-key-store-updater',
      artifactResolver: props.artifactResolver,
      memorySize: 128,
      environment: {
        ISSUERS: props.issuers.join(','),
        AUTH_KEY_STORE_TABLE_NAME: props.authKeyStoreTable.tableName,
      },
    });

    // Grant permissions
    props.authKeyStoreTable.grantReadWriteData(this);
  }
}
