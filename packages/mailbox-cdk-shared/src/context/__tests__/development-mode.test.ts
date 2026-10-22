/// <reference types="jest" />

/**
 * Pins how development mode is read from CDK context. A customer install passes no context, so an absent
 * key must mean production behaviour (retained resources); a malformed value must throw, because silently
 * reading it as false would leave a dev stack undestroyable and silently reading it as true would make a
 * production stack's data deletable.
 */

import * as cdk                                                                                 from 'aws-cdk-lib';

import { DEVELOPMENT_CONTEXT_KEY }                                                              from '../context-keys';
import { autoDeleteObjectsInDevelopment, isDevelopmentMode, removalPolicyForRetainedResources } from '../development-mode';

function stackWith(value?: unknown): cdk.Stack {
  const context = value === undefined ? {} : { [DEVELOPMENT_CONTEXT_KEY]: value };
  return new cdk.Stack(new cdk.App({ context }), 'TestStack');
}

describe('isDevelopmentMode', () => {
  it('is false when the context key is absent', () => {
    expect(isDevelopmentMode(stackWith())).toBe(false);
  });

  it('is false when the context value is null', () => {
    expect(isDevelopmentMode(stackWith(null))).toBe(false);
  });

  it.each([true, 'true', ' TRUE ', '1', 'yes', 'y', 'dev'])('is true for %p', (value) => {
    expect(isDevelopmentMode(stackWith(value))).toBe(true);
  });

  it.each([false, 'false', '0', 'no', 'n'])('is false for %p', (value) => {
    expect(isDevelopmentMode(stackWith(value))).toBe(false);
  });

  it('throws naming the key and the value when the value is not boolean-like', () => {
    expect(() => isDevelopmentMode(stackWith('maybe'))).toThrow(
      `invalid CDK context value for "${DEVELOPMENT_CONTEXT_KEY}": "maybe"`,
    );
  });
});

describe('removalPolicyForRetainedResources', () => {
  it('retains in production', () => {
    expect(removalPolicyForRetainedResources(stackWith())).toBe(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
  });

  it('destroys in development mode', () => {
    expect(removalPolicyForRetainedResources(stackWith(true))).toBe(cdk.RemovalPolicy.DESTROY);
  });
});

describe('autoDeleteObjectsInDevelopment', () => {
  it('is on in development mode only', () => {
    expect(autoDeleteObjectsInDevelopment(stackWith(true))).toBe(true);
    expect(autoDeleteObjectsInDevelopment(stackWith())).toBe(false);
  });
});
