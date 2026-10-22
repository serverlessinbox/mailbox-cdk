/**
 * Pins the scope-to-permissions table, which is derived from the permission-to-scope table. A scope that grants
 * more than the one permission it is named for is granted, or checked, under the wrong OAuth scope, and nothing at
 * synth time notices.
 */

import { Permission }                                          from '@serverlessinbox/mailbox';

import { CognitoScopeToPermissions, PermissionToCognitoScope } from '../cognito-scopemap';

describe('Cognito scope tables', () => {
  it.each(Object.values(Permission))('maps permission %s to a scope that grants exactly that permission', (permission) => {
    expect(CognitoScopeToPermissions[PermissionToCognitoScope[permission]]).toEqual([permission]);
  });
});
