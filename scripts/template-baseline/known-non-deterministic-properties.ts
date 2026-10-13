import type { NonDeterministicProperty } from './template-diff';

/** Properties that differ between synths of identical code; `diff` lists them apart instead of failing on them. */
export const KNOWN_NON_DETERMINISTIC_PROPERTIES: readonly NonDeterministicProperty[] = [
  {
    resourceType: 'Custom::ContentInvalidation',
    propertyPath: 'Properties.deploymentNonce',
    reason:
      'The nonce embeds a sha256 of the deployed config body as it reads at construction time, and CDK numbers the token placeholders inside that body in the order tokens are created, so the hash changes whenever the construction order changes.',
  },
];
