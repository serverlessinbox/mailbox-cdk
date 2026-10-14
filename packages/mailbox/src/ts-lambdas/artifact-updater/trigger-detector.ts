import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import type { CfnTrigger } from './cfn-trigger';
import type { HttpTrigger, HttpTriggerResponse } from './http-trigger';
import type { ScheduledTrigger } from './scheduled-trigger';
import { isCfnTriggerEvent, isHttpTriggerEvent, type HttpTriggerEvent } from './updater-event';
import type { UpdaterTrigger } from './updater-trigger';

type DispatchMode = 'cfn-custom-resource' | 'http-api' | 'eventbridge-or-self-invoke';

/** What the detector builds the trigger of an event with: one builder per trigger. */
export interface TriggerBuilder {
  cfnTrigger(event: CloudFormationCustomResourceEvent, context: Context): CfnTrigger;
  httpTrigger(event: HttpTriggerEvent): HttpTrigger;
  scheduledTrigger(): ScheduledTrigger;
}

/**
 * Tells which trigger an event belongs to and has it built. A CloudFormation request and an HTTP API request
 * are recognised by their shape; every other event, which the updater does not read, is a scheduled run or a
 * self-invoke.
 */
export class TriggerDetector {
  private readonly builder: TriggerBuilder;

  constructor(builder: TriggerBuilder) {
    this.builder = builder;
  }

  public detect(event: unknown, context: Context): UpdaterTrigger<HttpTriggerResponse | void> {
    if (isCfnTriggerEvent(event)) {
      this.logDispatch('cfn-custom-resource');
      return this.builder.cfnTrigger(event, context);
    }

    if (isHttpTriggerEvent(event)) {
      this.logDispatch('http-api');
      return this.builder.httpTrigger(event);
    }

    this.logDispatch('eventbridge-or-self-invoke');
    return this.builder.scheduledTrigger();
  }

  // Every invocation states which trigger fired; this line is part of no outcome-dependent trace, so it bypasses the buffer.
  private logDispatch(mode: DispatchMode): void {
    console.info('artifact-updater dispatch', { mode });
  }
}
