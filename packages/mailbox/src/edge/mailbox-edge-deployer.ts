import { CustomResource, Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MailboxEdgeDeployerProps {
  /** Name of the us-east-1 edge stack to create/update */
  readonly edgeStackName: string;

  /** S3 https URL to the versioned edge stack template */
  readonly templateUrl: string;

  /** Parameters passed to the edge stack */
  readonly parameters?: Record<string, string | undefined>;

  /** Whether to enable termination protection on the edge stack (default: false) */
  readonly terminationProtection?: boolean;
}

/**
 * Deploys/updates a separate us-east-1 CloudFormation stack from a template in S3,
 * and exposes its Outputs back into the current (regional) stack.
 */
export class MailboxEdgeDeployer extends Construct {
  public readonly edgeStackId: string;

  /** Exposes the raw output map (access via getOutput). */
  private readonly resource: CustomResource;

  constructor(scope: Construct, id: string, props: MailboxEdgeDeployerProps) {
    super(scope, id);

    const handler = new NodejsFunction(this, 'handler', {
      entry: path.join(__dirname, 'mailbox-edge-deployer.handler.ts'),
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    // Allow managing a CloudFormation stack in us-east-1.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplateSummary',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:RequestedRegion': 'us-east-1',
          },
        },
      })
    );

    this.resource = new CustomResource(this, 'resource', {
      serviceToken: handler.functionArn,
      resourceType: 'Custom::MailboxEdgeDeployer',
      properties: {
        stackName: props.edgeStackName,
        templateUrl: props.templateUrl,
        parameters: props.parameters ?? {},
        terminationProtection: props.terminationProtection ?? false,
      },
    });

    this.edgeStackId = this.resource.ref;

    // Ensure stable ordering during deploy when used alongside other resources.
    Stack.of(this).node.addDependency(this.resource);
  }

  /** Read a specific CloudFormation output (OutputKey) from the deployed edge stack. */
  public getOutput(outputKey: string): string {
    return this.resource.getAttString(outputKey);
  }
}
