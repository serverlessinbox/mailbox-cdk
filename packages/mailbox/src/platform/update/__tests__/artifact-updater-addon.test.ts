/// <reference types="jest" />

/**
 * ArtifactUpdaterAddon: the route spec it hands the Admin API for the artifact updater. The authorizer in
 * front of the route belongs to the Admin API, so only the spec the addon declares is asserted here.
 */

import { HttpMethod }                      from 'aws-cdk-lib/aws-apigatewayv2';

import { newInlineFunction, newTestStack } from '../../__tests__/platform-helpers';
import { ArtifactUpdaterAddon }            from '../artifact-updater-addon';

describe('ArtifactUpdaterAddon', () => {
  const updater = newInlineFunction(newTestStack('TestStack'), 'updater');
  const sut     = new ArtifactUpdaterAddon(updater);

  it('mounts /artifact-updates for POST and GET', () => {
    expect(sut.routeSpec?.basePath).toBe('/artifact-updates');
    expect(sut.routeSpec?.methods).toEqual([HttpMethod.POST, HttpMethod.GET]);
  });

  it('routes to the function it was given', () => {
    expect(sut.routeSpec?.handler).toBe(updater);
  });
});
