import { AnswerDeliveryFailure } from '../answer-delivery-failure';

/**
 * Pins the type the failure answerer rethrows without answering again. If `instanceof` stopped recognising it,
 * an undeliverable answer would be answered a second time.
 */
describe('AnswerDeliveryFailure', () => {
  it('is recognised as an AnswerDeliveryFailure and as an Error, and keeps its message', () => {
    const failure = new AnswerDeliveryFailure('Failed to PUT CloudFormation response (attempts: 4)');

    expect(failure).toBeInstanceOf(AnswerDeliveryFailure);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe('AnswerDeliveryFailure');
    expect(failure.message).toBe('Failed to PUT CloudFormation response (attempts: 4)');
  });
});
