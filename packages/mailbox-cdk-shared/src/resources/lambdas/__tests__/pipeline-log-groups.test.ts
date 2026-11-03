/**
 * Pins the one-log-group-per-(stack, pipeline) contract, the group name and the removal policies.
 * A group is `RETAIN`ed, so a changed name or a second group per pipeline leaves an orphan behind
 * and breaks the delete-and-recreate of a stack.
 */

import { Match, Template }        from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { App, Stack }             from 'aws-cdk-lib';

import { getOrCreateSharedGroup } from '../../../tagging/shared-group';
import { PipelineLogGroup }       from '../pipeline-log-groups';

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

function logGroupResources(stack: Stack) {
  return Template.fromStack(stack).findResources('AWS::Logs::LogGroup');
}

describe('PipelineLogGroup', () => {
  it('getOrCreate returns the same construct for two calls with the same (stack, pipeline)', () => {
    const stack = newStack();

    const first  = PipelineLogGroup.getOrCreate(stack, 'jmap');
    const second = PipelineLogGroup.getOrCreate(stack, 'jmap');

    expect(second).toBe(first);
  });

  it('getOrCreate returns distinct groups named /serverlessinbox/<stack>/<pipeline>-<guid prefix>', () => {
    const stack = newStack();

    const jmap  = PipelineLogGroup.getOrCreate(stack, 'jmap');
    const admin = PipelineLogGroup.getOrCreate(stack, 'admin');

    expect(jmap).not.toBe(admin);
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Logs::LogGroup', 2);
    for (const pipeline of ['jmap', 'admin']) {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: {
          'Fn::Join': ['', Match.arrayWith(['/serverlessinbox/', { Ref: 'AWS::StackName' }, `/${pipeline}-`])],
        },
      });
    }
  });

  it('getOrCreate throws when another kind of construct occupies the pipeline\'s slot', () => {
    const stack = newStack();
    new Role(getOrCreateSharedGroup(stack), 'log-group-jmap', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });

    expect(() => PipelineLogGroup.getOrCreate(stack, 'jmap')).toThrow(/Expected PipelineLogGroup at log-group-jmap, but found Role/);
  });

  it('the infra group is retained on every operation, including a create rollback', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'infra');

    const groups = Object.values(logGroupResources(stack));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
  });

  it('other pipeline groups keep RETAIN_ON_UPDATE_OR_DELETE, which a create rollback deletes', () => {
    const stack = newStack();
    PipelineLogGroup.getOrCreate(stack, 'jmap');

    const groups = Object.values(logGroupResources(stack));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ DeletionPolicy: 'RetainExceptOnCreate' });
  });

  it('groupLevelArn is the log-group-format ARN of the group, with the account and region as Ref tokens and no trailing :*', () => {
    const stack    = newStack();
    const logGroup = PipelineLogGroup.getOrCreate(stack, 'jmap');

    const groupLevelArn = JSON.stringify(stack.resolve(logGroup.groupLevelArn));

    expect(groupLevelArn).toContain('":log-group:"');
    expect(groupLevelArn).toContain('{"Ref":"AWS::AccountId"}');
    expect(groupLevelArn).not.toContain('111122223333');
    expect(groupLevelArn).not.toMatch(/:\*"\]\}$/);
  });
});
