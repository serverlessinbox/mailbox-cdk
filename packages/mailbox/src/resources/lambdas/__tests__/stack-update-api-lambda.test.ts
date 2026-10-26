/**
 * StackUpdateApiLambda: the variables the Go handler reads by name, the grants it requests for
 * itself on its table, queue and template-version parameter, and the complete set of statements it
 * adds itself: one that lets it prepare change sets and read the root stack, and one that limits the
 * S3 read to the release pointers and template objects of the registry project. The collaborators
 * render no policy here, so the role's statements equal that set exactly: a widened statement lets
 * the Lambda change more than the root stack, a narrowed one breaks the update flow where only a
 * deploy shows it, and any further statement fails the equality.
 */

import { Template }                                                                from 'aws-cdk-lib/assertions';

import { StackUpdateApiLambda }                                                    from '../stack-update-api-lambda';

import { expectGrantedOnceTo, fakeDataTable, fakeQueue, fakeTemplateVersionParam } from './lambda-wrapper-fakes';
import { arrangeWrapperStack, onlyLambdaOf }                                       from './lambda-wrapper-helpers';

const ROOT_STACK_ARN = 'arn:aws:cloudformation:us-west-2:123456789012:stack/root/id';

function synthesize() {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const configTable                 = fakeDataTable('config-table');
  const auditEventsQueue            = fakeQueue('audit-events');
  const templateVersionParam        = fakeTemplateVersionParam('template-version-param');
  const lambda                      = new StackUpdateApiLambda(stack, 'stack-update-api', {
    rootStackArn: ROOT_STACK_ARN,
    configTable,
    artifactResolver,
    templateVersionParam,
    pointerBucket:       'pointer-bucket',
    pointerKey:          'serverlessinbox/templates/mailbox-standard/releases/stable.json',
    templateUrlTemplate: 'https://pointer-bucket.s3.us-west-2.amazonaws.com/template-{version}',
    auditEventsQueue,
  });

  return { lambda, configTable, auditEventsQueue, templateVersionParam, ...onlyLambdaOf(Template.fromStack(stack)) };
}

describe('StackUpdateApiLambda', () => {
  it('passes the root stack, pointer, template URL and resource names to the handler by name', () => {
    expect(synthesize().environment).toMatchObject({
      ROOT_STACK_ARN:              ROOT_STACK_ARN,
      CONFIG_TABLE_NAME:           'config-table',
      TEMPLATE_VERSION_PARAM_NAME: 'template-version-param',
      POINTER_BUCKET:              'pointer-bucket',
      POINTER_KEY:                 'serverlessinbox/templates/mailbox-standard/releases/stable.json',
      TEMPLATE_URL_TEMPLATE:       'https://pointer-bucket.s3.us-west-2.amazonaws.com/template-{version}',
      AUDIT_EVENTS_QUEUE_URL:      'https://sqs.fake/audit-events',
    });
  });

  it('requests read on the config table, send on the audit-events queue and read on the template-version parameter for itself', () => {
    const { lambda, configTable, auditEventsQueue, templateVersionParam } = synthesize();

    expectGrantedOnceTo(configTable.grantRead, lambda);
    expectGrantedOnceTo(auditEventsQueue.grantSend, lambda);
    expectGrantedOnceTo(templateVersionParam.grantRead, lambda);
  });

  it('adds exactly two statements: change sets on the root stack, and the release objects of the registry project in every region', () => {
    expect(synthesize().statements).toEqual([
      {
        Action:   [
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:ListChangeSets',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        Effect:   'Allow',
        Resource: ROOT_STACK_ARN,
      },
      {
        Action:   's3:GetObject',
        Effect:   'Allow',
        Resource: 'arn:aws:s3:::test-artifacts-*/serverlessinbox/templates/*/releases/*',
      },
    ]);
  });
});
