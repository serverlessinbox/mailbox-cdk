import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { getOrCreatePipelineLogGroup } from '../pipeline-log-groups';

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

describe('getOrCreatePipelineLogGroup', () => {
  it('returns the same construct for two calls with the same (stack, pipeline)', () => {
    const stack = newStack();

    const first = getOrCreatePipelineLogGroup(stack, 'jmap');
    const second = getOrCreatePipelineLogGroup(stack, 'jmap');

    expect(second).toBe(first);
  });

  it('returns distinct, correctly-named groups for two different pipelines', () => {
    const stack = newStack();

    const jmap = getOrCreatePipelineLogGroup(stack, 'jmap');
    const admin = getOrCreatePipelineLogGroup(stack, 'admin');

    expect(jmap).not.toBe(admin);

    const template = Template.fromStack(stack);
    const groups = template.findResources('AWS::Logs::LogGroup');
    const names = Object.values(groups).map((g: any) => JSON.stringify(g.Properties.LogGroupName));

    expect(names.some((n) => n.includes('"/serverlessinbox/"') || n.includes('serverlessinbox'))).toBe(true);
    expect(Object.keys(groups)).toHaveLength(2);
  });

  it('never produces a log group name beginning with "aws/"', () => {
    const stack = newStack();
    getOrCreatePipelineLogGroup(stack, 'infra');

    const template = Template.fromStack(stack);
    const groups = template.findResources('AWS::Logs::LogGroup');
    for (const group of Object.values(groups)) {
      const nameParts = (group as any).Properties.LogGroupName['Fn::Join'][1] as string[];
      expect(nameParts[0]).toBe('/serverlessinbox/');
    }
  });

  it('tags every pipeline log group with serverless-inbox:root-stack', () => {
    const stack = newStack();
    getOrCreatePipelineLogGroup(stack, 'audit');

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'serverless-inbox:root-stack' }),
      ]),
    });
  });
});
