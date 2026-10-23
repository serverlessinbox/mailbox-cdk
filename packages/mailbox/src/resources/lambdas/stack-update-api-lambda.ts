import type { IArtifactResolver }                                     from '@serverlessinbox/artifact-registry-cdk';
import { buildArtifactArn, buildReleasePointerKey }                   from '@serverlessinbox/artifact-registry';
import { GoLambda }                                                   from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                            from 'aws-cdk-lib/aws-iam';
import { Duration }                                                   from 'aws-cdk-lib';
import { Construct }                                                  from 'constructs';

import type { ITemplateVersionParam }                                 from '../../contracts/template-version-param';
import type { IAuditEventsQueue }                                     from '../queues/audit-events-queue';
import type { IDataTable }                                            from '../tables/data-tables';

/**
 * The root stack, config table, template location and audit queue the stack-update API works against.
 * It does not create the root stack or the template artifacts; the caller supplies their names and
 * references.
 */
export interface StackUpdateApiLambdaProps {
  readonly rootStackArn:     string;
  readonly configTable:      IDataTable;
  readonly artifactResolver: IArtifactResolver;
  /** The parameter holding the deployed template version; the Lambda reads it and grants itself read access. */
  readonly templateVersionParam: ITemplateVersionParam;
  readonly pointerBucket:        string;
  readonly pointerKey:           string;
  readonly templateUrlTemplate:  string;
  readonly auditEventsQueue:     IAuditEventsQueue;
}

/**
 * StackUpdate Lambda for human-gated CloudFormation ChangeSet operations
 * against the root stack.
 *
 * Prepares CloudFormation ChangeSets and reads template artifacts from S3. It does not execute
 * ChangeSets or manage stack rollback: those are performed manually in the AWS console under the
 * operator's own credentials.
 */
export class StackUpdateApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: StackUpdateApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'stack-update-api',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        ROOT_STACK_ARN:              props.rootStackArn,
        CONFIG_TABLE_NAME:           props.configTable.tableName,
        TEMPLATE_VERSION_PARAM_NAME: props.templateVersionParam.parameterName,
        POINTER_BUCKET:              props.pointerBucket,
        POINTER_KEY:                 props.pointerKey,
        TEMPLATE_URL_TEMPLATE:       props.templateUrlTemplate,
        AUDIT_EVENTS_QUEUE_URL:      props.auditEventsQueue.queueUrl,
      },
    });

    this.grantRootStackChangeSets(props.rootStackArn);
    this.grantTemplateArtifactRead(props.artifactResolver);
    props.configTable.grantRead(this);
    props.auditEventsQueue.grantSend(this);
    props.templateVersionParam.grantRead(this);
  }

  private grantRootStackChangeSets(rootStackArn: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   [
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:ListChangeSets',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        resources: [rootStackArn],
      }),
    );
  }

  private grantTemplateArtifactRead(artifactResolver: IArtifactResolver): void {
    const { bucketBase, project } = artifactResolver.location;
    const bucketInEveryRegion     = `${bucketBase}-*`;

    // A release pointer key ends in `<distTag>.json`; without the extension the pattern matches every
    // object under `releases/`: the pointers and the versioned template objects.
    const releaseObjectKeys = buildReleasePointerKey('template', '*', { project, distTag: '*' }).replace(/\.json$/, '');

    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['s3:GetObject'],
        resources: [buildArtifactArn(bucketInEveryRegion, releaseObjectKeys)],
      }),
    );
  }
}
