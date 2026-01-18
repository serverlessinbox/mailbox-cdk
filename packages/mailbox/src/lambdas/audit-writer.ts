import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface AuditWriterLambdaProps {
  auditLogTable: ITable;
  artifactResolver: IArtifactResolver;
}

export class AuditWriterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuditWriterLambdaProps) {
    super(scope, id, {
      lambdaId: 'audit-writer',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: {
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
      },
    });

    // Grant permissions
    props.auditLogTable.grantReadWriteData(this);
  }
}
