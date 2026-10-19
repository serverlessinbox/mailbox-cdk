/**
 * The two scope tables are written out by hand, one the inverse of the other. A permission whose scope maps
 * back to a different permission is granted, or checked, under the wrong OAuth scope, and nothing at synth
 * time notices, so these tests pin that the tables stay inverse.
 */

import { Permission } from '@serverlessinbox/mailbox';
import { CognitoScope, CognitoScopeToPermissions, PermissionToCognitoScope } from '../cognito';

describe('Cognito scope tables', () => {
  it.each(Object.values(Permission))('maps permission %s to a scope that grants exactly that permission', (permission) => {
    expect(CognitoScopeToPermissions[PermissionToCognitoScope[permission]]).toEqual([permission]);
  });

  it.each(Object.values(CognitoScope))('maps scope %s to permissions that all map back to that scope', (scope) => {
    for (const permission of CognitoScopeToPermissions[scope]) {
      expect(PermissionToCognitoScope[permission]).toBe(scope);
    }
  });
});
