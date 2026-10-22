/**
 * Coverage for `SweepStarterComposition`: the Step Functions and CloudFormation clients of the starter are
 * built in the region of the starter config, not in whatever region the environment resolves. A starter that
 * started its execution in another region than its state machine would answer SUCCESS to CloudFormation
 * while no sweep ever ran.
 */

import { CloudFormationClient, DescribeStacksCommand }                        from '@aws-sdk/client-cloudformation';
import { SFNClient, ListExecutionsCommand, StartExecutionCommand }            from '@aws-sdk/client-sfn';
import { LoggerBuffer, toRegion }                                             from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                         from 'aws-sdk-client-mock';

import { SweepStarterComposition }                                            from '../sweep-starter-composition';

import { STATE_MACHINE_ARN, deleteEvent, updateEvent }                        from './sweep-helpers';

const sfnMock = mockClient(SFNClient);
const cfnMock = mockClient(CloudFormationClient);

const STACK_REGION = 'eu-west-1';

async function regionOfSender(sender: unknown): Promise<string> {
  if (!(sender instanceof SFNClient || sender instanceof CloudFormationClient)) {
    throw new Error('the call was not made by an AWS client');
  }
  return sender.config.region();
}

function sweepStarter() {
  const composition = new SweepStarterComposition({
    logLevel:               'error',
    serviceName:            'sweeper-starter',
    region:                 toRegion(STACK_REGION),
    sweeperStateMachineArn: STATE_MACHINE_ARN,
  });
  return composition.sweepStarter(new LoggerBuffer());
}

describe('SweepStarterComposition', () => {
  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({});
    cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [{ StackName: 'parent', CreationTime: new Date(), StackStatus: 'DELETE_IN_PROGRESS' }] });
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts the execution through a Step Functions client in the region of the config', async () => {
    await sweepStarter().handle(updateEvent());

    expect(await regionOfSender(sfnMock.commandCall(0, StartExecutionCommand).thisValue)).toBe(STACK_REGION);
  });

  it('reads the parent stack status through a CloudFormation client in the region of the config', async () => {
    await sweepStarter().handle(deleteEvent());

    expect(await regionOfSender(cfnMock.call(0).thisValue)).toBe(STACK_REGION);
  });
});
