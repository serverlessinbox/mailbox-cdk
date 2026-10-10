/**
 * Pins how `SupportAddonProvider` builds the support addon from its own settings and the Admin API
 * addon context: the mode is forwarded, and the context's config table, audit queue and artifact
 * resolver reach the addon instead of defaults. A regression here deploys the addon against the
 * wrong table or queue, or with Lambda code from the wrong artifact release.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { SupportMode } from '../support-addon';
import { SupportAddonProvider } from '../support-addon-provider';
import {
  createAddonContext,
  createArtifactResolver,
  createSupportTestStack,
  findFunction,
} from './support-test-fixtures';

const SUPPORT_API = 'support-api';

describe('SupportAddonProvider', () => {
  it('creates one addon in DISABLED mode that provisions nothing', () => {
    const inputs = createSupportTestStack();

    const addons = new SupportAddonProvider({ mode: SupportMode.DISABLED }).createAdminApiAddons(inputs.stack, createAddonContext(inputs));

    expect(addons).toHaveLength(1);
    expect(addons[0].uiConfig).toEqual({ support: { available: false } });
    Template.fromStack(inputs.stack).resourceCountIs('AWS::Lambda::Function', 0);
  });

  it('creates one addon in ENABLED mode that provisions the support-api Lambda', () => {
    const inputs = createSupportTestStack();

    const addons = new SupportAddonProvider({ mode: SupportMode.ENABLED }).createAdminApiAddons(inputs.stack, createAddonContext(inputs));

    expect(addons).toHaveLength(1);
    expect(addons[0].uiConfig).toEqual({ support: { available: true } });
    findFunction(Template.fromStack(inputs.stack), SUPPORT_API);
  });

  it('wires the context config table and audit queue into the support-api Lambda', () => {
    const inputs = createSupportTestStack();

    new SupportAddonProvider({ mode: SupportMode.ENABLED }).createAdminApiAddons(inputs.stack, createAddonContext(inputs));

    const template = Template.fromStack(inputs.stack);
    const [configTableId] = Object.keys(template.findResources('AWS::DynamoDB::Table')).filter((id) => id.startsWith('configtable'));
    const [auditQueueId] = Object.keys(template.findResources('AWS::SQS::Queue')).filter((id) => id.startsWith('auditqueue') && !id.includes('dlq'));
    expect(findFunction(template, SUPPORT_API).environment).toEqual(expect.objectContaining({
      CONFIG_TABLE_NAME: { Ref: configTableId },
      AUDIT_EVENTS_QUEUE_URL: { Ref: auditQueueId },
    }));
  });

  it('resolves the Lambda code through the context artifact resolver', () => {
    const inputs = createSupportTestStack();
    const context = { ...createAddonContext(inputs), artifactResolver: createArtifactResolver(inputs.stack, '9.9.9') };

    new SupportAddonProvider({ mode: SupportMode.ENABLED }).createAdminApiAddons(inputs.stack, context);

    const template = Template.fromStack(inputs.stack);
    const supportApi = Object.values(template.findResources('AWS::Lambda::Function'))
      .find((fn) => fn.Properties.Environment?.Variables?.SERVICE_NAME === SUPPORT_API);
    expect(supportApi?.Properties.Code.S3Key).toContain('9.9.9');
  });
});
