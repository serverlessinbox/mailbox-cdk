import { BaselineSynthesizer }  from '../baseline-synthesizer';
import { FrozenProcessValues }  from '../frozen-process-values';

/**
 * Pins the contract the baseline gates on: the synthesizer yields the four named templates, and two
 * synths of the same code are equal. The stack names key the stored baselines, and the equality
 * keeps a template that varies between runs from failing a refactor's gate.
 */
describe('BaselineSynthesizer', () => {
  const SYNTH_TIMEOUT_MILLIS = 120_000;

  const synthesize = () => new BaselineSynthesizer(FrozenProcessValues.forBaseline()).synthesize();

  it('synthesizes the mailbox, edge, data and cognito-data templates', () => {
    const stackNames = synthesize().map((stackTemplate) => stackTemplate.stackName);

    expect(stackNames).toEqual(['mailbox', 'edge', 'data', 'cognito-data']);
  }, SYNTH_TIMEOUT_MILLIS);

  it('synthesizes identical templates on every run', () => {
    const firstRun  = synthesize();
    const secondRun = synthesize();

    expect(secondRun).toEqual(firstRun);
  }, SYNTH_TIMEOUT_MILLIS);
});
