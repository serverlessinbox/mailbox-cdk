import { ArnFormat, CustomResource, Stack } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IArtifactResolver } from '../../artifacts/artifact-resolver';
import { TypeScriptLambda } from '../../utils/ts-lambda';

export interface LogGroupRetentionProps {
  /**
   * Artifact resolver used to locate the log-retention handler lambda artifact.
   */
  readonly artifactResolver: IArtifactResolver;

  /**
   * Lambda whose log group retention should be managed.
   */
  readonly lambdaFunction: IFunction;

  /**
   * Retention to apply.
   *
   * Default: ONE_MONTH.
   */
  readonly retention?: RetentionDays;
}

class LogGroupRetentionProvider extends Construct {
  public readonly handler: IFunction;

  public static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): LogGroupRetentionProvider {
    const stack = Stack.of(scope);
    const existing = stack.node.tryFindChild('log-group-retention-provider');
    if (existing) {
      return existing as LogGroupRetentionProvider;
    }
    return new LogGroupRetentionProvider(stack, 'log-group-retention-provider', { artifactResolver });
  }

  private constructor(scope: Construct, id: string, props: { artifactResolver: IArtifactResolver }) {
    super(scope, id);

    this.handler = new TypeScriptLambda(this, 'log-group-retention-handler', {
      lambdaId: 'log-group-retention',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      logGroupRetention: false,
    });

    const stack = Stack.of(this);
    const lambdaLogGroupsArn = stack.formatArn({
      service: 'logs',
      resource: 'log-group',
      resourceName: '/aws/lambda/*',
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    this.handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['logs:PutRetentionPolicy'],
        resources: [lambdaLogGroupsArn, `${lambdaLogGroupsArn}:*`],
      }),
    );
  }
}

/**
 * Applies a retention policy to a Lambda's default log group ("/aws/lambda/<functionName>")
 * without using CDK's built-in log retention providers.
 */
export class LogGroupRetention extends Construct {
  constructor(scope: Construct, id: string, props: LogGroupRetentionProps) {
    super(scope, id);

    const provider = LogGroupRetentionProvider.getOrCreate(this, props.artifactResolver);
    const retention = props.retention ?? RetentionDays.ONE_MONTH;
    const logGroupName = `/aws/lambda/${props.lambdaFunction.functionName}`;

    new CustomResource(this, 'resource', {
      serviceToken: provider.handler.functionArn,
      resourceType: 'Custom::MailboxLogGroupRetention',
      properties: {
        LogGroupName: logGroupName,
        RetentionInDays: retention,
      },
    });
  }
}
