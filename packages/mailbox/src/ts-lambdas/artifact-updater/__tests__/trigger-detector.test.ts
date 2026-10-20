/// <reference types="jest" />

/**
 * Pins how events are routed to triggers: a CloudFormation request to the CFN trigger, an HTTP API request to
 * the HTTP trigger, anything else to the scheduled trigger; and that each detection logs which trigger fired,
 * outside the buffered logger. A misrouted event would run the wrong work for the invoker. The builder is faked,
 * so what the detector returns is exactly what it asked the builder for.
 */

import { LoggerBuffer }                         from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { CfnTrigger }                           from '../cfn-trigger';
import { HttpTrigger }                          from '../http-trigger';
import { ScheduledTrigger }                     from '../scheduled-trigger';
import { TriggerDetector, type TriggerBuilder } from '../trigger-detector';

import {
  badConfigCycle,
  deployEndTriggerEvent,
  fakeCloudFormationClient,
  fakeLambdaContext,
  httpApiEvent,
} from './updater-helpers';

describe('TriggerDetector', () => {
  const context          = fakeLambdaContext();
  const cfnEvent         = deployEndTriggerEvent('Create');
  const httpEvent        = httpApiEvent('POST', '/artifact-updates/trigger');
  const cfnTrigger       = new CfnTrigger(cfnEvent, context, badConfigCycle, fakeCloudFormationClient(), undefined, 'artifact-updater');
  const httpTrigger      = new HttpTrigger(httpEvent, () => { throw new Error('unused'); }, 'fn', new LoggerBuffer(), undefined);
  const scheduledTrigger = new ScheduledTrigger(badConfigCycle);

  const builder: jest.Mocked<TriggerBuilder> = {
    cfnTrigger: jest.fn().mockReturnValue(cfnTrigger),
    httpTrigger: jest.fn().mockReturnValue(httpTrigger),
    scheduledTrigger: jest.fn().mockReturnValue(scheduledTrigger),
  };
  const detector                             = new TriggerDetector(builder);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has the CFN trigger built for a CloudFormation request, and logs it', () => {
    const trigger = detector.detect(cfnEvent, context);

    expect(trigger).toBe(cfnTrigger);
    expect(builder.cfnTrigger).toHaveBeenCalledWith(cfnEvent, context);
    expect(console.info).toHaveBeenCalledWith('artifact-updater dispatch', { mode: 'cfn-custom-resource' });
  });

  it('has the HTTP trigger built for an HTTP API request, and logs it', () => {
    const trigger = detector.detect(httpEvent, context);

    expect(trigger).toBe(httpTrigger);
    expect(builder.httpTrigger).toHaveBeenCalledWith(httpEvent);
    expect(console.info).toHaveBeenCalledWith('artifact-updater dispatch', { mode: 'http-api' });
  });

  it('has the scheduled trigger built for any other event, and logs it', () => {
    const trigger = detector.detect({}, context);

    expect(trigger).toBe(scheduledTrigger);
    expect(builder.cfnTrigger).not.toHaveBeenCalled();
    expect(builder.httpTrigger).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith('artifact-updater dispatch', { mode: 'eventbridge-or-self-invoke' });
  });
});
