import { App, BootstraplessSynthesizer, Token }   from 'aws-cdk-lib';

import { StandaloneStackFactory }                 from '../standalone-stack-factory';

/**
 * Pins what the factory gives every consumer: the stack ids carry the consumer's prefix, the edge stack
 * sits in us-east-1 in the data account, the cognito stack is environment-agnostic when given none, and
 * every stack uses the bootstrapless synthesizer. A change to any of these changes the templates a
 * consumer ships, so the assertions read the stacks the factory returns, not a copy of its logic.
 */
describe('StandaloneStackFactory', () => {
  const DATA_ENVIRONMENT    = { account: '111122223333', region: 'eu-west-2' };
  const COGNITO_ENVIRONMENT = { account: '444455556666', region: 'eu-west-1' };

  it.each(['Mailbox', 'Baseline'])('prefixes the stack ids with %s', (idPrefix) => {
    const factory = new StandaloneStackFactory(idPrefix, DATA_ENVIRONMENT, COGNITO_ENVIRONMENT);

    expect(factory.createDataStack(new App()).node.id).toBe(`${idPrefix}Data`);
    expect(factory.createEdgeStack(new App()).node.id).toBe(`${idPrefix}Edge`);
    expect(factory.createCognitoDataStack(new App()).node.id).toBe(`${idPrefix}CognitoData`);
  });

  it('places the edge stack in us-east-1 in the data account', () => {
    const factory = new StandaloneStackFactory('Mailbox', DATA_ENVIRONMENT, COGNITO_ENVIRONMENT);

    const edgeStack = factory.createEdgeStack(new App());

    expect(edgeStack.region).toBe('us-east-1');
    expect(edgeStack.account).toBe(DATA_ENVIRONMENT.account);
  });

  it('passes the data environment to the data stack', () => {
    const factory = new StandaloneStackFactory('Mailbox', DATA_ENVIRONMENT, COGNITO_ENVIRONMENT);

    const dataStack = factory.createDataStack(new App());

    expect(dataStack.account).toBe(DATA_ENVIRONMENT.account);
    expect(dataStack.region).toBe(DATA_ENVIRONMENT.region);
  });

  it('passes the cognito environment to the cognito stack when one is given', () => {
    const factory = new StandaloneStackFactory('Mailbox', DATA_ENVIRONMENT, COGNITO_ENVIRONMENT);

    const cognitoStack = factory.createCognitoDataStack(new App());

    expect(cognitoStack.account).toBe(COGNITO_ENVIRONMENT.account);
    expect(cognitoStack.region).toBe(COGNITO_ENVIRONMENT.region);
  });

  it('leaves the cognito stack environment-agnostic when none is given', () => {
    const factory = new StandaloneStackFactory('Mailbox', DATA_ENVIRONMENT, undefined);

    const cognitoStack = factory.createCognitoDataStack(new App());

    expect(Token.isUnresolved(cognitoStack.account)).toBe(true);
    expect(Token.isUnresolved(cognitoStack.region)).toBe(true);
  });

  it('gives every stack the bootstrapless synthesizer', () => {
    const factory = new StandaloneStackFactory('Mailbox', DATA_ENVIRONMENT, COGNITO_ENVIRONMENT);

    const stacks = [
      factory.createDataStack(new App()),
      factory.createEdgeStack(new App()),
      factory.createCognitoDataStack(new App()),
    ];

    for (const stack of stacks) {
      expect(stack.synthesizer).toBeInstanceOf(BootstraplessSynthesizer);
    }
  });
});
