import { IBucket } from "aws-cdk-lib/aws-s3";
import { GoLambda } from "../utils/go-lambda";
import { INamedTable } from "../utils/named-table";
import { ILambdaCodeProvider } from "../utils/lambda-code-provider";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs"

export interface EmailProcessorLambdaProps {
  configTable: INamedTable;
  itemTable: INamedTable;
  changelogTable: INamedTable;
  emailBucket: IBucket;
  codeProvider: ILambdaCodeProvider;
}

export class EmailProcessorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: EmailProcessorLambdaProps) {
    super(scope, id, {
      lambdaId: 'email-processor',
      codeProvider: props.codeProvider,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      environment: {
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
      },
    });

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    // Grant the Lambda function permissions to read from the S3 bucket
    props.emailBucket.grantReadWrite(this);    
  }
}