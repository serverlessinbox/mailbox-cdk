import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface JWKCacheUpdaterLambdaProps {
  issuers: string[];
  jwkCacheTable: ITable;
  artifactResolver: IArtifactResolver;
}

export class JWKCacheUpdaterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: JWKCacheUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId: 'jwk-dynamo-cache-updater',
      artifactResolver: props.artifactResolver,
      memorySize: 128,
      timeout: Duration.seconds(30),
      environment: {
        ISSUERS: props.issuers.join(','),
        TABLE_NAME: props.jwkCacheTable.tableName,
        HMAC_KEY_ROTATION_DAYS: '30',
      },
    });

    // Grant permissions
    props.jwkCacheTable.grantReadWriteData(this);
  }
}
