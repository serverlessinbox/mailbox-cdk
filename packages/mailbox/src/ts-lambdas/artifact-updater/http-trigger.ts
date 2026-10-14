import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { CaughtError, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { hasHttpRequestLine, type HttpTriggerEvent } from './updater-event';
import type { UpdaterTrigger } from './updater-trigger';

/** The response to an HTTP API request. */
export interface HttpTriggerResponse {
  readonly statusCode: number;
  readonly body: string;
}

/** The method and path of an HTTP API request; an absent one reads as empty. */
interface RequestLine {
  readonly method: string;
  readonly path: string;
}

/**
 * Answers the HTTP API requests of the admin UI trigger: POST to a path containing `/trigger` starts an update
 * cycle in the background, with a function invocation that is not waited for, and is answered 202; any other
 * request is answered 404; a bad configuration is answered 500 naming the problem.
 */
export class HttpTrigger implements UpdaterTrigger<HttpTriggerResponse> {
  private readonly event: HttpTriggerEvent;
  private readonly deploymentLambda: () => LambdaClient;
  private readonly functionName: string;
  private readonly logger: LoggerBuffer;
  private readonly configError: string | undefined;

  /** `deploymentLambda` throws the configuration error when the configuration failed to load. */
  constructor(
    event: HttpTriggerEvent,
    deploymentLambda: () => LambdaClient,
    functionName: string,
    logger: LoggerBuffer,
    configError: string | undefined,
  ) {
    this.event = event;
    this.deploymentLambda = deploymentLambda;
    this.functionName = functionName;
    this.logger = logger;
    this.configError = configError;
  }

  /** Throws when the background invocation cannot be started. */
  public async handle(): Promise<HttpTriggerResponse> {
    if (this.configError !== undefined) {
      return this.answerBadConfig(this.configError);
    }

    const { method, path } = this.readRequest();

    if (method === 'POST' && path.includes('/trigger')) {
      await this.startUpdateInBackground();
      return { statusCode: 202, body: JSON.stringify({ status: 'triggered' }) };
    }

    return { statusCode: 404, body: '' };
  }

  /** Logs the failure and answers 500 with its message. */
  public answerFailure(thrown: unknown): HttpTriggerResponse {
    const caught = new CaughtError(thrown);
    this.logger.error('Failed to trigger update', {
      errorName: caught.name,
      errorMessage: caught.message,
    });
    return HttpTrigger.serverError(`Failed to trigger update: ${caught.message}`);
  }

  private static serverError(message: string): HttpTriggerResponse {
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }

  /** There is no logger before the configuration loads, so the problem goes straight to the console. */
  private answerBadConfig(configError: string): HttpTriggerResponse {
    console.error('Configuration error', { error: configError });
    return HttpTrigger.serverError(`Configuration error: ${configError}`);
  }

  /** A request whose method and path cannot be read has neither, and is answered 404. */
  private readRequest(): RequestLine {
    const line = this.lineOf(this.event);
    this.logger.debug('http trigger received',{ method: line.method, path: line.path });
    return line;
  }

  private lineOf(event: HttpTriggerEvent): RequestLine {
    if (!hasHttpRequestLine(event)) {
      return { method: '', path: '' };
    }
    return {
      method: event.requestContext.http?.method ?? '',
      path: event.requestContext.http?.path ?? event.rawPath ?? '',
    };
  }

  /** An empty payload makes the invoked function run the update cycle, as a scheduled run does. */
  private async startUpdateInBackground(): Promise<void> {
    this.logger.debug('dispatching self-invoke');
    await this.deploymentLambda().send(
      new InvokeCommand({
        FunctionName: this.functionName,
        InvocationType: 'Event',
        Payload: JSON.stringify({}),
      }),
    );
    this.logger.debug('self-invoke dispatched');
  }
}
