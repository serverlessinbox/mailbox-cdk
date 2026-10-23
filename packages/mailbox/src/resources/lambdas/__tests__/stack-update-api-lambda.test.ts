/**
 * Pins the environment names and grants of `StackUpdateApiLambda`: the variables the Go handler reads
 * by name, the single statement that lets it prepare change sets and read the root stack, the S3
 * read limited to the release pointers and template objects of the registry project, and the read
 * of the template-version parameter. A widened statement lets the Lambda change more than the root
 * stack; a narrowed one breaks the update flow where only a deploy shows it.
 */

import { actionsOf }                            from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                             from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                 from 'aws-cdk-lib/aws-dynamodb';

import { TemplateVersionParam }                 from '../../../platform/update/template-version-param';
import { AuditEventsQueue }                     from '../../queues/audit-events-queue';
import { DataTable }                            from '../../tables/data-tables';
import { StackUpdateApiLambda }                 from '../stack-update-api-lambda';

import { arrangeWrapperStack, onlyLambdaOf }    from './lambda-wrapper-helpers';
import type { SynthesizedLambda }               from './lambda-wrapper-helpers';

function synthesize(): SynthesizedLambda {
  const { stack, artifactResolver } = arrangeWrapperStack();

  new StackUpdateApiLambda(stack, 'stack-update-api', {
    rootStackArn: 'arn:aws:cloudformation:us-west-2:123456789012:stack/root/id',
    configTable:  new DataTable(new Table(stack, 'config-table', { partitionKey: { name: 'pk', type: AttributeType.STRING } })),
    artifactResolver,
    templateVersionParam: new TemplateVersionParam(stack, 'template-version', { templateVersion: 'v1.0.0' }),
    pointerBucket:        'pointer-bucket',
    pointerKey:           'serverlessinbox/templates/mailbox-standard/releases/stable.json',
    templateUrlTemplate:  'https://pointer-bucket.s3.us-west-2.amazonaws.com/template-{version}',
    auditEventsQueue:     new AuditEventsQueue(stack, 'audit-events-queue'),
  });

  return onlyLambdaOf(Template.fromStack(stack));
}

describe('StackUpdateApiLambda', () => {
  const { environment, statements } = synthesize();
  const statementGranting           = (action: string) => statements.filter((statement) => actionsOf(statement).includes(action));

  it('passes the root stack, pointer and template URL to the handler by name', () => {
    expect(environment).toMatchObject({
      ROOT_STACK_ARN:        'arn:aws:cloudformation:us-west-2:123456789012:stack/root/id',
      POINTER_BUCKET:        'pointer-bucket',
      POINTER_KEY:           'serverlessinbox/templates/mailbox-standard/releases/stable.json',
      TEMPLATE_URL_TEMPLATE: 'https://pointer-bucket.s3.us-west-2.amazonaws.com/template-{version}',
    });
  });

  it('passes the table, queue and template-version parameter names to the handler by name', () => {
    expect(Object.keys(environment)).toEqual(expect.arrayContaining([
      'CONFIG_TABLE_NAME',
      'AUDIT_EVENTS_QUEUE_URL',
      'TEMPLATE_VERSION_PARAM_NAME',
    ]));
  });

  it('prepares change sets and reads the root stack in one statement scoped to the root stack', () => {
    const changeSetStatements = statementGranting('cloudformation:CreateChangeSet');

    expect(changeSetStatements).toHaveLength(1);
    expect(changeSetStatements[0].Action).toEqual([
      'cloudformation:CreateChangeSet',
      'cloudformation:DescribeChangeSet',
      'cloudformation:DeleteChangeSet',
      'cloudformation:ListChangeSets',
      'cloudformation:DescribeStacks',
      'cloudformation:DescribeStackEvents',
      'cloudformation:GetTemplate',
    ]);
    expect(changeSetStatements[0].Resource).toBe('arn:aws:cloudformation:us-west-2:123456789012:stack/root/id');
  });

  it('reads every release object of the registry project in every region', () => {
    const objectReads = statementGranting('s3:GetObject');

    expect(objectReads).toHaveLength(1);
    expect(objectReads[0].Resource).toBe('arn:aws:s3:::test-artifacts-*/serverlessinbox/templates/*/releases/*');
  });

  it('reads the template-version parameter', () => {
    const parameterReads = statementGranting('ssm:GetParameter');

    expect(parameterReads).toHaveLength(1);
    expect(parameterReads[0].Action).toEqual([
      'ssm:DescribeParameters',
      'ssm:GetParameters',
      'ssm:GetParameter',
      'ssm:GetParameterHistory',
    ]);
    expect(JSON.stringify(parameterReads[0].Resource)).toContain(':ssm:us-west-2:123456789012:parameter/');
  });
});
