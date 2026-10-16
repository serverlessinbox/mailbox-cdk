import { toPhysicalResourceId } from '../../shared/custom-resource-identifiers';
import { AnswerDeliveryFailure } from '../answer-delivery-failure';
import { CfnResponder } from '../cfn-responder';
import { cfnRequest, fakeCfnEndpoint, LOG_STREAM_NAME, replyTarget, RESPONSE_URL, sfnEvent, STACK_ID, STACK_NAME } from './stack-deployer-helpers';

/**
 * Pins the answer CloudFormation receives. The deployer answers by PUT to the response URL itself, so a wrong
 * body, status or content-type is a custom resource that never completes or completes wrongly, and a reason
 * over the size CloudFormation accepts is an answer it rejects. A PUT that is not delivered must end the
 * invocation loudly after a bounded number of attempts, never answer twice.
 */
describe('CfnResponder', () => {
  let pauses: number[];
  let responder: CfnResponder;

  beforeEach(() => {
    pauses = [];
    responder = new CfnResponder(async (milliseconds) => {
      pauses.push(milliseconds);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('targetForRequest', () => {
    it('addresses the answer with the envelope of the request and names the resource after its stack', () => {
      const request = cfnRequest({ ResourceType: 'Custom::MailboxDataDeployer' });

      expect(responder.targetForRequest(request, LOG_STREAM_NAME)).toEqual({
        cfn: {
          ResponseURL: RESPONSE_URL,
          StackId: STACK_ID,
          RequestId: 'request-123',
          LogicalResourceId: 'MailboxDeployer',
          ResourceType: 'Custom::MailboxDataDeployer',
        },
        physicalResourceId: STACK_NAME,
        logStreamName: LOG_STREAM_NAME,
      });
    });

    it('names the resource with the physical id CloudFormation sent, whatever the stack name', () => {
      const request = cfnRequest({ RequestType: 'Update', PhysicalResourceId: toPhysicalResourceId('sent-by-cloudformation') });

      const target = responder.targetForRequest(request, LOG_STREAM_NAME);

      expect(target.physicalResourceId).toBe('sent-by-cloudformation');
      expect(target.cfn.PhysicalResourceId).toBe('sent-by-cloudformation');
    });

    it('names the resource MailboxStack when the request names no stack', () => {
      const request = cfnRequest({ ResourceProperties: {} });

      expect(responder.targetForRequest(request, undefined).physicalResourceId).toBe('MailboxStack');
    });
  });

  describe('targetForStep', () => {
    it('answers on the envelope of the workflow input and names the resource after the stack of its operation', () => {
      const event = sfnEvent();

      expect(responder.targetForStep(event, LOG_STREAM_NAME)).toEqual({
        cfn: event.cfn,
        physicalResourceId: STACK_NAME,
        logStreamName: LOG_STREAM_NAME,
      });
    });
  });

  describe('targetForStep physical id', () => {
    it('keeps the physical id CloudFormation sent, whatever the stack of the operation', () => {
      const event = sfnEvent();
      const withId = { ...event, cfn: { ...event.cfn, PhysicalResourceId: toPhysicalResourceId('sent-by-cloudformation') } };

      expect(responder.targetForStep(withId, LOG_STREAM_NAME).physicalResourceId).toBe('sent-by-cloudformation');
    });
  });

  describe('succeed', () => {
    it('PUTs a SUCCESS body to the response URL with an empty content-type, as CloudFormation expects', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

      await responder.succeed(replyTarget(), { reason: 'done', data: { TableName: 'items' } });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(RESPONSE_URL);
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toEqual({ 'content-type': '' });
      expect(JSON.parse(String(init?.body))).toEqual({
        Status: 'SUCCESS',
        Reason: 'done',
        PhysicalResourceId: STACK_NAME,
        StackId: STACK_ID,
        RequestId: 'request-123',
        LogicalResourceId: 'MailboxDeployer',
        NoEcho: false,
        Data: { TableName: 'items' },
      });
    });

    it('sends empty Data when the answer carries none', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.succeed(replyTarget());

      expect(endpoint.answers()[0].Data).toEqual({});
    });

    it('points the reason at the log stream when the answer gives none', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.succeed(replyTarget({ logStreamName: LOG_STREAM_NAME }));

      expect(endpoint.answers()[0].Reason).toBe(`See CloudWatch Log Stream: ${LOG_STREAM_NAME}`);
    });

    it('sends no reason when the answer gives none and there is no log stream', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.succeed(replyTarget({ logStreamName: undefined }));

      expect(endpoint.answers()[0].Reason).toBeUndefined();
    });

    it('keeps an empty reason rather than replacing it with the log stream', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.succeed(replyTarget(), { reason: '' });

      expect(endpoint.answers()[0].Reason).toBe('');
    });
  });

  describe('fail', () => {
    it('PUTs a FAILED body with the reason', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.fail(replyTarget(), 'the stack failed');

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'the stack failed', Data: {} })]);
    });
  });

  describe('answerFailure', () => {
    it('answers a Delete SUCCESS with the reason, so it never blocks the parent stack', async () => {
      const endpoint = fakeCfnEndpoint();

      await responder.answerFailure(replyTarget(), 'Delete', 'could not delete');

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Reason: 'could not delete' })]);
    });

    it.each(['Create', 'Update', undefined] as const)('answers a %s request FAILED with the reason', async (requestType) => {
      const endpoint = fakeCfnEndpoint();

      await responder.answerFailure(replyTarget(), requestType, 'could not deploy');

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'could not deploy' })]);
    });
  });

  describe('the reason of an answer', () => {
    it('keeps a reason at the limit whole', async () => {
      const endpoint = fakeCfnEndpoint();
      const reason = 'x'.repeat(3500);

      await responder.fail(replyTarget(), reason);

      expect(endpoint.answers()[0].Reason).toBe(reason);
    });

    it.each(['fail', 'succeed'] as const)('truncates a longer reason to the limit and marks it when the answer is a %s', async (answer) => {
      const endpoint = fakeCfnEndpoint();
      const reason = 'x'.repeat(3501);

      if (answer === 'fail') {
        await responder.fail(replyTarget(), reason);
      } else {
        await responder.succeed(replyTarget(), { reason });
      }

      const sent = endpoint.answers()[0].Reason ?? '';
      expect(sent).toBe(`${'x'.repeat(3480)} …(truncated)`);
      expect(sent.length).toBeLessThanOrEqual(3500);
    });
  });

  describe('targetForAnswerable', () => {
    it('addresses the answer with the envelope it was given and names the resource after the stack when it is known', () => {
      const cfn = sfnEvent().cfn;

      expect(responder.targetForAnswerable({ cfn, physicalResourceId: undefined, requestType: 'Create', stackName: STACK_NAME }, LOG_STREAM_NAME)).toEqual({
        cfn,
        physicalResourceId: STACK_NAME,
        logStreamName: LOG_STREAM_NAME,
      });
    });

    it('names the resource MailboxStack when the stack is not known', () => {
      const target = responder.targetForAnswerable({ cfn: sfnEvent().cfn, physicalResourceId: undefined, requestType: undefined, stackName: undefined }, undefined);

      expect(target.physicalResourceId).toBe('MailboxStack');
    });

    it('keeps the physical id CloudFormation sent over the stack name', () => {
      const answerable = { cfn: sfnEvent().cfn, physicalResourceId: toPhysicalResourceId('sent-by-cloudformation'), requestType: 'Update', stackName: STACK_NAME } as const;

      expect(responder.targetForAnswerable(answerable, undefined).physicalResourceId).toBe('sent-by-cloudformation');
    });
  });

  describe('a response CloudFormation does not accept', () => {
    it('throws the delivery failure with the HTTP status and the body, without trying again, when the rejection is final', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('signature expired', { status: 403 }));

      const failure = await responder.fail(replyTarget(), 'x').catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(AnswerDeliveryFailure);
      expect(failure).toHaveProperty('message', 'Failed to PUT CloudFormation response (HTTP 403): signature expired (attempts: 1)');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws with the HTTP status when the body cannot be read', async () => {
      const unreadable = new Response('', { status: 400 });
      jest.spyOn(unreadable, 'text').mockRejectedValue(new Error('stream closed'));
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(unreadable);

      await expect(responder.fail(replyTarget(), 'x')).rejects.toThrow('Failed to PUT CloudFormation response (HTTP 400):  (attempts: 1)');
    });

    it('tries a 5xx again after 250, 500 and 1000 ms and delivers the answer when a later attempt is accepted', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('busy', { status: 503 }))
        .mockResolvedValueOnce(new Response('busy', { status: 500 }))
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      await responder.fail(replyTarget(), 'x');

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(pauses).toEqual([250, 500]);
    });

    it('tries a network error again, and throws the delivery failure after four attempts', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

      const failure = await responder.fail(replyTarget(), 'x').catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(AnswerDeliveryFailure);
      expect(failure).toHaveProperty('message', 'Failed to PUT CloudFormation response: TypeError: fetch failed (attempts: 4)');
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(pauses).toEqual([250, 500, 1000]);
    });
  });
});
