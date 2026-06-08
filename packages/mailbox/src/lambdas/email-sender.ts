import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface EmailSenderLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  blobStore: IBucket;
  sesConfigSetName: string;
  artifactResolver: IArtifactResolver;
}

export class EmailSenderLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: EmailSenderLambdaProps) {
    super(scope, id, {
      lambdaId: 'email-sender',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        BLOB_STORE_NAME: props.blobStore.bucketName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
      },
    });

    // Grant permissions
    props.configTable.grantReadData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    props.blobStore.grantRead(this);

    // Grant SES send permissions
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendRawEmail'],
        resources: ['*'],
      })
    );
  }
}
