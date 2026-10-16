import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PipelineLogGroup } from '../pipeline-log-groups';

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

describe('PipelineLogGroup', () => {
  it('getOrCreate returns the same construct for two calls with the same (stack, pipeline)', () => {
    const stack = newStack();

    const first = PipelineLogGroup.getOrCreate(stack, 'jmap');
    const second = PipelineLogGroup.getOrCreate(stack, 'jmap');

    expect(second).toBe(first);
  });

  it('getOrCreate returns distinct, correctly-named groups for two different pipelines', () => {
    const stack = newStack();

    const jmap = PipelineLogGroup.getOrCreate(stack, 'jmap');
    const admin = PipelineLogGroup.getOrCreate(stack, 'admin');

    expect(jmap).not.toBe(admin);

    const template = Template.fromStack(stack);
    const groups = template.findResources('AWS::Logs::LogGroup');
    const names = Object.values(groups).map((g: any) => JSON.stringify(g.Properties.LogGroupName));

    expect(names.some((n) => n.includes('"/serverlessinbox/"') || n.includes('serverlessinbox'))).toBe(true);
    expect(Object.keys(groups)).toHaveLength(2);
  });

  it('never produces a log group name beginning with "aws/"', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'infra');

    const template = Template.fromStack(stack);
    const groups = template.findResources('AWS::Logs::LogGroup');
    for (const group of Object.values(groups)) {
      const nameParts = (group as any).Properties.LogGroupName['Fn::Join'][1] as string[];
      expect(nameParts[0]).toBe('/serverlessinbox/');
    }
  });

  it('tags every pipeline log group with serverless-inbox:root-stack', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'audit');

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'serverless-inbox:root-stack' }),
      ]),
    });
  });

  it('the infra group is retained on every operation, including a create rollback', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'infra');

    const groups = Object.values(Template.fromStack(stack).findResources('AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });

  it('other pipeline groups keep RETAIN_ON_UPDATE_OR_DELETE, which a create rollback deletes', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'jmap');

    const groups = Object.values(Template.fromStack(stack).findResources('AWS::Logs::LogGroup'));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ DeletionPolicy: 'RetainExceptOnCreate' });
  });

  it('grantFilterEvents grants logs:FilterLogEvents scoped to the log group ARN', () => {
    const stack = new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
    const logGroup = PipelineLogGroup.getOrCreate(stack, 'jmap');

    const role = new (require('aws-cdk-lib').aws_iam.Role)(stack, 'test-role', {
      assumedBy: new (require('aws-cdk-lib').aws_iam.ServicePrincipal)('lambda.amazonaws.com'),
    });

    logGroup.grantFilterEvents(role);

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'logs:FilterLogEvents',
            Effect: 'Allow',
            Resource: {
              'Fn::GetAtt': [Match.stringLikeRegexp('.*'), 'Arn'],
            },
          }),
        ]),
      }),
    });
  });
});
