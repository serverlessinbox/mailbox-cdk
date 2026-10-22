/**
 * Coverage for `SweepWorker`: a payload that is not a removal of a known type is rejected before any
 * sweeper runs, each `removalType` reaches the sweeper of that type with its own payload, and a sweep
 * outcome is the status Step Functions branches on. The sweepers are fakes.
 */

import { InvalidOwnInput, LoggerBuffer }                                                                                                                     from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { CertRemovalInput, EdgeFunctionRemovalInput, StackFailureDetectorRemovalInput, StackFailureDetectorRemovalTarget, TargetResult, TargetSweeper } from '../removal';
import { SweepWorker }                                                                                                                                       from '../sweep-worker';

const SWEPT: TargetResult = { target: 'cert', status: 'SUCCESS' };

const CERT_INPUT: CertRemovalInput                       = {
  certArn:       'arn:aws:acm:us-west-2:123456789012:certificate/abc',
  rootStackName: 'test-stack',
  rootStackId:   'guid-1',
};
const EDGE_INPUT: EdgeFunctionRemovalInput               = {
  edgeFnArn:     'arn:aws:lambda:us-east-1:123456789012:function:edge',
  rootStackName: 'test-stack',
  rootStackId:   'guid-1',
};
const ROOT_STACK                                         = { rootStackName: 'test-stack', rootStackId: 'guid-1' };
const DETECTOR_TARGET: StackFailureDetectorRemovalTarget = {
  ruleArn:                'arn:aws:events:us-west-2:123456789012:rule/r',
  ruleTargetId:           'Target0',
  detectorFnArn:          'arn:aws:lambda:us-west-2:123456789012:function:f',
  detectorRoleArn:        'arn:aws:iam::123456789012:role/ro',
  detectorRolePolicyName: 'p',
};

function sweeperAnswering<TInput>(result: TargetResult): jest.Mocked<TargetSweeper<TInput>> {
  return { sweep: jest.fn().mockResolvedValue(result) };
}

function workerWith(results: { cert?: TargetResult; edge?: TargetResult; detector?: TargetResult } = {}) {
  const cert     = sweeperAnswering<CertRemovalInput>(results.cert ?? SWEPT);
  const edge     = sweeperAnswering<EdgeFunctionRemovalInput>(results.edge ?? SWEPT);
  const detector = sweeperAnswering<StackFailureDetectorRemovalInput>(results.detector ?? SWEPT);
  const worker   = new SweepWorker(new LoggerBuffer('resource-sweeper-worker', 'error'), cert, edge, detector);
  return { worker, cert, edge, detector };
}

describe('SweepWorker', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('payload', () => {
    it('rejects a removal type no sweeper handles, as an InvalidOwnInput naming the field and carrying the payload, before any sweep', async () => {
      const { worker, cert, edge, detector } = workerWith();

      const rejection = worker.handle({ removalType: 'queue', ...CERT_INPUT });

      await expect(rejection).rejects.toBeInstanceOf(InvalidOwnInput);
      await expect(rejection).rejects.toThrow('removalType');
      await expect(rejection).rejects.toHaveProperty('input', { removalType: 'queue', ...CERT_INPUT });
      expect(cert.sweep).not.toHaveBeenCalled();
      expect(edge.sweep).not.toHaveBeenCalled();
      expect(detector.sweep).not.toHaveBeenCalled();
    });

    it('rejects a detector payload whose rule target id is empty, which would remove no target', async () => {
      const { worker, detector } = workerWith();

      const rejection = worker.handle({ removalType: 'detector', target: { ...DETECTOR_TARGET, ruleTargetId: '' }, ...ROOT_STACK });

      await expect(rejection).rejects.toBeInstanceOf(InvalidOwnInput);
      expect(detector.sweep).not.toHaveBeenCalled();
    });

    it('rejects a detector payload with a half part, which would sweep a resource it cannot address', async () => {
      const { worker, detector } = workerWith();

      const rejection = worker.handle({ removalType: 'detector', target: { ruleArn: DETECTOR_TARGET.ruleArn }, ...ROOT_STACK });

      await expect(rejection).rejects.toThrow('must carry all of its fields or none');
      expect(detector.sweep).not.toHaveBeenCalled();
    });

    it('rejects a detector payload with no part, which would sweep nothing', async () => {
      const { worker, detector } = workerWith();

      const rejection = worker.handle({ removalType: 'detector', target: {}, ...ROOT_STACK });

      await expect(rejection).rejects.toThrow('at least one detector part');
      expect(detector.sweep).not.toHaveBeenCalled();
    });
  });

  describe('dispatch', () => {
    it('hands a cert payload only to the cert sweeper', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'cert', ...CERT_INPUT });

      expect(cert.sweep).toHaveBeenCalledWith(expect.objectContaining(CERT_INPUT));
      expect(edge.sweep).not.toHaveBeenCalled();
      expect(detector.sweep).not.toHaveBeenCalled();
    });

    it('hands an edge-fn payload only to the edge function sweeper', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'edge-fn', ...EDGE_INPUT });

      expect(edge.sweep).toHaveBeenCalledWith(expect.objectContaining(EDGE_INPUT));
      expect(cert.sweep).not.toHaveBeenCalled();
      expect(detector.sweep).not.toHaveBeenCalled();
    });

    it('hands a detector payload only to the stack-failure detector sweeper, its parts beside the root stack', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'detector', target: DETECTOR_TARGET, ...ROOT_STACK });

      expect(detector.sweep).toHaveBeenCalledWith({ ...DETECTOR_TARGET, ...ROOT_STACK });
      expect(cert.sweep).not.toHaveBeenCalled();
      expect(edge.sweep).not.toHaveBeenCalled();
    });

    it('hands a detector payload with only the rule part to the sweeper with only the rule part', async () => {
      const { worker, detector } = workerWith();

      await worker.handle({ removalType: 'detector', target: { ruleArn: DETECTOR_TARGET.ruleArn, ruleTargetId: DETECTOR_TARGET.ruleTargetId }, ...ROOT_STACK });

      expect(detector.sweep).toHaveBeenCalledWith({
        ruleArn:      DETECTOR_TARGET.ruleArn,
        ruleTargetId: DETECTOR_TARGET.ruleTargetId,
        ...ROOT_STACK,
      });
    });
  });

  describe('outcome', () => {
    it.each<[string, TargetResult, unknown]>([
      ['swept', { target: 'cert', status: 'SUCCESS' }, { status: 'SUCCESS' }],
      ['retry', { target: 'cert', status: 'RETRY', reason: 'InUseBy: x' }, { status: 'RETRY', reason: 'InUseBy: x' }],
      ['failed', { target: 'cert', status: 'FAILED', reason: 'boom' }, { status: 'FAILED', reason: 'boom' }],
    ])('answers a %s sweep with its status and reason', async (_name, result, expected) => {
      const { worker } = workerWith({ cert: result });

      const output = await worker.handle({ removalType: 'cert', ...CERT_INPUT });

      expect(output).toEqual(expected);
    });
  });
});
