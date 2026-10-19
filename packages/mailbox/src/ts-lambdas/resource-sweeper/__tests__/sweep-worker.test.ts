/**
 * Coverage for `SweepWorker`: each `removalType` reaches the sweeper of that type with its own
 * payload, and a sweep outcome maps to the worker status Step Functions branches on. The sweepers
 * are fakes.
 */

import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CertRemovalInput, EdgeFunctionRemovalInput, StackFailureDetectorRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { SweepWorker } from '../sweep-worker';

/** A sweeper fake that records the input it was handed and answers a fixed result after logging a trace line. */
class FakeSweeper<TInput> implements TargetSweeper<TInput> {
  public received: TInput | undefined;

  constructor(
    private readonly result: TargetResult,
    private readonly logger: LoggerBuffer,
  ) {}

  public async sweep(input: TInput): Promise<TargetResult> {
    this.received = input;
    this.logger.debug('sweeper trace');
    return this.result;
  }
}

const DONE: TargetResult = { target: 'cert', status: 'done' };

const CERT_INPUT: CertRemovalInput = {
  certArn: 'arn:aws:acm:us-west-2:123456789012:certificate/abc',
  rootStackName: 'test-stack',
  rootStackId: 'guid-1',
};
const EDGE_INPUT: EdgeFunctionRemovalInput = {
  edgeFnArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge',
  rootStackName: 'test-stack',
  rootStackId: 'guid-1',
};
const DETECTOR_INPUT: StackFailureDetectorRemovalInput = {
  ruleArn: 'arn:aws:events:us-west-2:123456789012:rule/r',
  ruleTargetId: 'Target0',
  detectorFnArn: 'arn:aws:lambda:us-west-2:123456789012:function:f',
  detectorRoleArn: 'arn:aws:iam::123456789012:role/ro',
  detectorRolePolicyName: 'p',
  rootStackName: 'test-stack',
  rootStackId: 'guid-1',
};

function workerWith(results: { cert?: TargetResult; edge?: TargetResult; detector?: TargetResult } = {}) {
  const logger = new LoggerBuffer('resource-sweeper-worker', 'error');
  const cert = new FakeSweeper<CertRemovalInput>(results.cert ?? DONE, logger);
  const edge = new FakeSweeper<EdgeFunctionRemovalInput>(results.edge ?? DONE, logger);
  const detector = new FakeSweeper<StackFailureDetectorRemovalInput>(results.detector ?? DONE, logger);
  const worker = new SweepWorker(logger, cert, edge, detector);
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

  describe('dispatch', () => {
    it('hands a cert payload only to the cert sweeper', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'cert', ...CERT_INPUT });

      expect(cert.received).toMatchObject(CERT_INPUT);
      expect(edge.received).toBeUndefined();
      expect(detector.received).toBeUndefined();
    });

    it('hands an edge-fn payload only to the edge function sweeper', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'edge-fn', ...EDGE_INPUT });

      expect(edge.received).toMatchObject(EDGE_INPUT);
      expect(cert.received).toBeUndefined();
      expect(detector.received).toBeUndefined();
    });

    it('hands a detector payload only to the stack-failure detector sweeper', async () => {
      const { worker, cert, edge, detector } = workerWith();

      await worker.handle({ removalType: 'detector', ...DETECTOR_INPUT });

      expect(detector.received).toMatchObject(DETECTOR_INPUT);
      expect(cert.received).toBeUndefined();
      expect(edge.received).toBeUndefined();
    });
  });

  describe('outcome', () => {
    it.each<[string, TargetResult, unknown]>([
      ['done', { target: 'cert', status: 'done' }, { status: 'SUCCESS' }],
      ['retry', { target: 'cert', status: 'retry', reason: 'InUseBy: x' }, { status: 'RETRY', reason: 'InUseBy: x' }],
      ['failed', { target: 'cert', status: 'failed', reason: 'boom' }, { status: 'FAILED', reason: 'boom' }],
    ])('maps a %s sweep to its worker status', async (_name, result, expected) => {
      const { worker } = workerWith({ cert: result });

      const output = await worker.handle({ removalType: 'cert', ...CERT_INPUT });

      expect(output).toEqual(expected);
    });
  });
});
