import { Aws, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { TypeScriptLambda } from '../utils/ts-lambda';

export interface EdgeDeployerGrantProps {
  stack: Stack;
  edgeStackArn: string;
  originDeployment: string;
  templateObjectArn: string;
  /** Additional S3 object ARNs (e.g. Lambda zip files) that CloudFormation needs to read during stack deployment. */
  artifactObjectArns: string[];
}

export function grantEdgeDeployerWorkerPermissions(
  worker: TypeScriptLambda,
  props: EdgeDeployerGrantProps,
): void {
  // IMPORTANT: use the *deployed* CloudFormation stack name, not the CDK logical stack id.
  const edgeStackName = `${Aws.STACK_NAME}-edge-stack`;

  // CloudFormation (when called without a RoleArn) uses the caller's permissions to create/delete
  // resources. Since the edge template creates CloudWatch Log Groups with RemovalPolicy.DESTROY,
  // the deployer needs explicit permissions to delete those log groups during stack deletion.
  const edgeLogGroupArnPrefix = props.stack.formatArn({
    service: 'logs',
    region: 'us-east-1',
    resource: 'log-group',
    // CDK-generated LogGroup names are prefixed with the stack name.
    resourceName: `${edgeStackName}*`,
  });

  // IMPORTANT: CDK-generated physical names for resources created by the edge stack template
  // are typically prefixed with the *stack name* (AWS::StackName) plus the logical id.
  // Since our deployer itself runs in a regional stack, and we want a synthesized template to work
  // under pure CloudFormation too, scope permissions using AWS::StackName rather than a hard-coded prefix.
  const edgeLambdaArnPrefix = props.stack.formatArn({
    service: 'lambda',
    region: 'us-east-1',
    resource: 'function',
    resourceName: `${Aws.STACK_NAME}-*`,
  });

  const edgeRoleArnPrefix = props.stack.formatArn({
    service: 'iam',
    region: '',
    // IAM is global (no region), but ARNs are account-scoped.
    account: props.stack.account,
    resource: 'role',
    resourceName: `${props.originDeployment}-*`,
  });

  // Allow the deployer to manage CloudFormation stacks in us-east-1
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'cloudformation:CreateStack',
        'cloudformation:UpdateStack',
        'cloudformation:DeleteStack',
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackEvents',
        'cloudformation:GetTemplateSummary',
        'cloudformation:GetStackPolicy',
        'cloudformation:SetStackPolicy',
      ],
      resources: [props.edgeStackArn],
    })
  );

  // Allow reading the edge stack template and ALL Lambda artifact zips from S3.
  // CloudFormation uses the CALLER's identity (this worker role) to fetch Lambda zip files
  // when creating AWS::Lambda::Function resources — individual object ARNs are not sufficient.
  // Edge artifacts are always in the us-east-1 artifact bucket regardless of regional stack.
  // The wildcard covers the template object, all Lambda zips, and any future artifacts in any channel.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        's3:GetObject',
        's3:GetObjectVersion',
      ],
      resources: [props.templateObjectArn, ...props.artifactObjectArns],
    })
  );

  // CloudFormation needs these permissions to create the edge resources
  // These are granted to the handler so it can pass them to CloudFormation
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'acm:RequestCertificate',
        'acm:DescribeCertificate',
        'acm:DeleteCertificate',
        'acm:ListTagsForCertificate',
        'acm:AddTagsToCertificate',
      ],
      resources: ['arn:aws:acm:us-east-1:*:certificate/*'],
    })
  );

  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'lambda:CreateFunction',
        'lambda:DeleteFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:GetFunction',
        'lambda:ListVersionsByFunction',
        'lambda:PublishVersion',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:TagResource',
        'lambda:UntagResource',
      ],
      resources: [edgeLambdaArnPrefix],
    })
  );

  // Some Lambda APIs (notably CreateFunction) are evaluated against resource "*".
  // Keep this safe by constraining the allowed function name prefix.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'lambda:CreateFunction',
        'lambda:DeleteFunction',
        'lambda:UpdateFunctionCode',
        'lambda:UpdateFunctionConfiguration',
        'lambda:GetFunction',
        'lambda:ListVersionsByFunction',
        'lambda:PublishVersion',
        'lambda:AddPermission',
        'lambda:RemovePermission',
        'lambda:TagResource',
        'lambda:UntagResource',
      ],
      resources: ['*'],
      conditions: {
        StringLike: {
          'lambda:FunctionName': `${Aws.STACK_NAME}-*`,
        },
      },
    })
  );

  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'iam:PassRole',
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PutRolePolicy',
        'iam:GetRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:GetRole',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
      ],
      resources: [edgeRoleArnPrefix],
    })
  );

  // CreateRole is sometimes evaluated against resource "*" (not the role ARN) which would bypass
  // the ARN-scoped statement above. Allow it explicitly.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['iam:CreateRole'],
      resources: ['*'],
    })
  );

  // Some IAM tagging paths are also evaluated against resource "*".
  // Grant unconditionally; deployer already has unconditional iam:CreateRole on *.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['iam:TagRole', 'iam:UntagRole', 'iam:DetachRolePolicy'],
      resources: ['*'],
    })
  );

  // IAM CreateRole (and initial tagging) is commonly evaluated against resource "*".
  // Grant unconditionally; scoping is handled by the ARN prefix at edgeRoleArnPrefix.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'iam:CreateRole',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PutRolePolicy',
        'iam:GetRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:GetRole',
        'iam:ListRolePolicies',
        'iam:ListAttachedRolePolicies',
        'iam:DeleteRole',
      ],
      resources: ['*'],
    })
  );

  // Some CloudFormation resources use the Resource Groups Tagging API behind the scenes.
  // Grant it broadly; the individual service actions above remain scoped.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'tag:GetResources',
        'tag:TagResources',
        'tag:UntagResources',
      ],
      resources: ['*'],
    })
  );

  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'logs:DeleteLogGroup',
        'logs:PutRetentionPolicy',
        // CloudFormation uses TagResource/UntagResource when creating Log Groups with tags.
        'logs:TagResource',
        'logs:UntagResource',
        // Backwards-compatible explicit log-group tagging APIs.
        'logs:TagLogGroup',
        'logs:UntagLogGroup',
      ],
      resources: [
        edgeLogGroupArnPrefix,
        // Some APIs (and some error reporting paths) refer to the log-stream ARN shape.
        `${edgeLogGroupArnPrefix}:log-stream:*`,
        // Some IAM evaluations use an extra suffix segment.
        `${edgeLogGroupArnPrefix}:*`,
      ],
    })
  );

  // Some CloudWatch Logs tagging calls are evaluated against resource "*" (or against an ARN shape
  // that doesn't match our prefix), which manifests as a missing logs:TagResource permission.
  // Keep this narrowly scoped to tagging operations only.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['logs:TagResource', 'logs:UntagResource'],
      resources: ['*'],
    })
  );

  // CloudFormation rollback/delete has repeatedly evaluated DeleteLogGroup in ways that don't match
  // our intended ARN prefix (notably showing a log-stream-shaped ARN in the error message).
  // To stop manual cleanups, allow DeleteLogGroup broadly for this worker.
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['logs:DeleteLogGroup'],
      resources: ['*'],
    })
  );

  // CreateLogGroup is typically evaluated against resource "*".
  worker.addToRolePolicy(
    new PolicyStatement({
      actions: ['logs:CreateLogGroup'],
      resources: ['*'],
    })
  );

  worker.addToRolePolicy(
    new PolicyStatement({
      actions: [
        'route53:ChangeResourceRecordSets',
        'route53:ListResourceRecordSets',
        'route53:GetChange',
      ],
      resources: ['*'],
    })
  );
}
