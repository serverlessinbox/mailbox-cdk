/// <reference types="jest" />

/**
 * LicenseRefresh feature tests.
 *
 * The license refresher must run every day and straight after each deploy or update of the stack that
 * owns it; if either rule is missing or points at another stack, licenses silently go stale.
 */

import { VENDOR_ACCOUNT_ID }                               from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                        from 'aws-cdk-lib/assertions';
import type { Stack }                                      from 'aws-cdk-lib';

import { newArtifactResolver, newDataTable, newTestStack } from '../../__tests__/platform-helpers';
import { LicenseRefresh }                                  from '../license-refresh';

describe('LicenseRefresh', () => {
  let stack: Stack;
  let template: Template;

  beforeEach(() => {
    stack = newTestStack('TestStack');
    new LicenseRefresh(stack, 'license-refresh', {
      configTable:      newDataTable(stack, 'config-table'),
      artifactResolver: newArtifactResolver(stack),
      coreDomain:       'example.com',
      vendorAccountIds: [VENDOR_ACCOUNT_ID],
    });
    template = Template.fromStack(stack);
  });

  describe('daily schedule', () => {
    function logicalIdOfSeededNumber(salt: string): string {
      const matches = Object.entries(template.findResources('Custom::StackHelpers', { Properties: { Salt: salt } }));
      expect(matches).toHaveLength(1);
      return matches[0][0];
    }

    it('resolves the hour from 24 values and the minute from 60, each with its own salt', () => {
      template.hasResourceProperties('Custom::StackHelpers', { Salt: 'license-refresh-hour', Range: '24' });
      template.hasResourceProperties('Custom::StackHelpers', { Salt: 'license-refresh-minute', Range: '60' });
      template.resourceCountIs('Custom::StackHelpers', 2);
    });

    it('refreshes once a day, at the resolved minute and hour', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: {
          'Fn::Join': ['', [
            'cron(',
            { 'Fn::GetAtt': [logicalIdOfSeededNumber('license-refresh-minute'), 'seededNumber'] },
            ' ',
            { 'Fn::GetAtt': [logicalIdOfSeededNumber('license-refresh-hour'), 'seededNumber'] },
            ' * * ? *)',
          ]],
        },
      });
    });
  });
});
