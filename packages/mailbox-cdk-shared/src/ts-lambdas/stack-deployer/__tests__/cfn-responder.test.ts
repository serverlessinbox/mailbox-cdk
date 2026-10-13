import { CfnResponder } from '../cfn-responder';
import { cfnRequest, fakeCfnEndpoint, LOG_STREAM_NAME, replyTarget, RESPONSE_URL, sfnEvent, STACK_ID, STACK_NAME } from './stack-deployer-helpers';

/**
 * Pins the answer CloudFormation receives. The deployer answers by PUT to the response URL itself, so a wrong
 * body, status or content-type is a custom resource that never completes or completes wrongly.
 */
describe('CfnResponder', () => {
  const responder = new CfnResponder();

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

    it.each(['Create', 'Update'] as const)('answers a %s FAILED with the reason', async (requestType) => {
      const endpoint = fakeCfnEndpoint();

      await responder.answerFailure(replyTarget(), requestType, 'could not deploy');

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'could not deploy' })]);
    });
  });

  describe('limitedReason', () => {
    it('keeps a reason at the limit whole', () => {
      const reason = 'x'.repeat(3500);

      expect(responder.limitedReason(reason)).toBe(reason);
    });

    it('truncates a longer reason to the limit and marks it', () => {
      const limited = responder.limitedReason('x'.repeat(3501));

      expect(limited).toBe(`${'x'.repeat(3480)} …(truncated)`);
      expect(limited.length).toBeLessThanOrEqual(3500);
    });

    it('is not applied by the answer itself, which sends the reason it is given', async () => {
      const endpoint = fakeCfnEndpoint();
      const reason = 'x'.repeat(4000);

      await responder.fail(replyTarget(), reason);

      expect(endpoint.answers()[0].Reason).toBe(reason);
    });
  });

  describe('a response CloudFormation does not accept', () => {
    it('throws with the HTTP status and the body it returned', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('signature expired', { status: 403 }));

      await expect(responder.fail(replyTarget(), 'x')).rejects.toThrow('Failed to PUT CloudFormation response (HTTP 403): signature expired');
    });

    it('throws with the HTTP status when the body cannot be read', async () => {
      const unreadable = new Response('', { status: 500 });
      jest.spyOn(unreadable, 'text').mockRejectedValue(new Error('stream closed'));
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(unreadable);

      await expect(responder.fail(replyTarget(), 'x')).rejects.toThrow('Failed to PUT CloudFormation response (HTTP 500): ');
    });
  });
});
