/**
 * Coverage for the starter handler's answer to a request the planner cannot read. A malformed entry in the
 * custom resource's old properties makes the planner throw. On an Update during a parent rollback that throw
 * must be answered SUCCESS with the unchanged physical id: CloudFormation re-sends the failed Update during
 * rollback, and a FAILED answer there strands the stack in UPDATE_ROLLBACK_FAILED. On a normal Update it must
 * stay FAILED, so a malformed template fails the deploy. A Delete is never validated by the planner, so the
 * malformed entry reaches the execution unchanged.
 *
 * Config is loaded when the handler module loads, so the environment is set before it is imported.
 */

const STATE_MACHINE_ARN                          = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';
process.env['SERVICE_NAME']                      = 'resource-sweeper';
process.env['AWS_REGION']                        = 'us-west-2';
process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = STATE_MACHINE_ARN;

import { CloudFormationClient, DescribeStacksCommand, type StackStatus }                         from '@aws-sdk/client-cloudformation';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand }                               from '@aws-sdk/client-sfn';
import { captureCfnResponse }                                                                    from '@serverlessinbox/mailbox-cdk-shared/runtime-test-support';
import type { CloudFormationCustomResourceEvent }                                                from 'aws-lambda';
import { mockClient }                                                                            from 'aws-sdk-client-mock';

import { starterHandler }                                                                        from '../handler';

import { PARENT_STACK_ID, lambdaContext }                                                        from './sweep-helpers';

// wrapHandler PUTs the CFN response over real `https`; captureCfnResponse routes it into memory.
jest.mock('https', () => ({ request: jest.fn() }));

const PHYSICAL_ID = 'mailbox-deferred-removal';

const sfnMock = mockClient(SFNClient);
const cfnMock = mockClient(CloudFormationClient);

/** A detector entry with every field but `detectorFnArn`, so the planner rejects it. */
const MALFORMED_DETECTOR_ENTRY = {
  ruleArn:                'arn:aws:events:us-west-2:123456789012:rule/detector',
  ruleTargetId:           'detector-target',
  detectorRoleArn:        'arn:aws:iam::123456789012:role/detector',
  detectorRolePolicyName: 'detector-policy',
};

const TEMPLATE_KEYS = { ServiceToken: 'arn:aws:lambda:us-west-2:123456789012:function:starter', ServiceTimeout: '120' };

const baseEvent = {
  ServiceToken:      TEMPLATE_KEYS.ServiceToken,
  ResponseURL:       'https://example.com/response',
  StackId:           PARENT_STACK_ID,
  RequestId:         'request-rollback',
  LogicalResourceId: 'DeferredRemoval',
  ResourceType:      'Custom::DeferredRemoval',
};

function updateWithMalformedOldEntry(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:           'Update',
    PhysicalResourceId:    PHYSICAL_ID,
    ResourceProperties:    { ...TEMPLATE_KEYS },
    OldResourceProperties: { ...TEMPLATE_KEYS, detector: MALFORMED_DETECTOR_ENTRY },
  };
}

function deleteWithMalformedEntry(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:        'Delete',
    PhysicalResourceId: PHYSICAL_ID,
    ResourceProperties: { ...TEMPLATE_KEYS, detector: MALFORMED_DETECTOR_ENTRY },
  };
}

function givenStackStatus(stackStatus: StackStatus): void {
  cfnMock.on(DescribeStacksCommand).resolves({
    Stacks: [{ StackName: 'test-stack', StackStatus: stackStatus, CreationTime: new Date() }],
  });
}

describe('starterHandler on an Update during a parent rollback', () => {
  let cfnResponse: ReturnType<typeof captureCfnResponse>;

  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    givenStackStatus('UPDATE_ROLLBACK_IN_PROGRESS');
    cfnResponse = captureCfnResponse();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS with the unchanged physical id and empty Data, and starts no execution', async () => {
    await starterHandler(updateWithMalformedOldEntry(), lambdaContext());

    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: PHYSICAL_ID, Data: {} });
    expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
  });

  it('logs the failed planner read once as a Handler failed error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await starterHandler(updateWithMalformedOldEntry(), lambdaContext());

    const handlerFailures = consoleError.mock.calls.filter(([line]) => JSON.stringify(line).includes('Handler failed'));
    expect(handlerFailures).toHaveLength(1);
    expect(JSON.stringify(handlerFailures[0])).toContain('Invalid detector entry in OldResourceProperties');
  });
});

describe('starterHandler on an Update outside a parent rollback', () => {
  let cfnResponse: ReturnType<typeof captureCfnResponse>;

  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    givenStackStatus('UPDATE_IN_PROGRESS');
    cfnResponse = captureCfnResponse();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers FAILED naming the malformed old entry, so the deploy fails', async () => {
    await starterHandler(updateWithMalformedOldEntry(), lambdaContext());

    const response = cfnResponse();
    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Invalid detector entry in OldResourceProperties');
  });
});

describe('starterHandler on a Delete with a malformed entry', () => {
  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    givenStackStatus('DELETE_IN_PROGRESS');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS and sends the malformed entry to the execution unvalidated', async () => {
    const cfnResponse = captureCfnResponse();

    await starterHandler(deleteWithMalformedEntry(), lambdaContext());

    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: PHYSICAL_ID });
    expect(sfnMock.commandCalls(StartExecutionCommand)[0].args[0].input.input).toBe(
      JSON.stringify({ toSweep: { detector: MALFORMED_DETECTOR_ENTRY } }),
    );
  });
});
