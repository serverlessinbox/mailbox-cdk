/**
 * Child-Stack Template Baseline Tests — Mailbox Data & Edge Stacks
 *
 * TEMPORARY: Grant Concept Phase 0 baseline gate (removed in Phase 13)
 *
 * Captures full synthesized CloudFormation templates for child stacks (data, edge).
 * Every subsequent phase must produce byte-identical templates except where explicitly
 * listed in the phase spec (e.g., child-stack-internal grant relocations in Phase 7B).
 *
 * Run with UPDATE_TEMPLATE_BASELINE=1 to regenerate fixtures:
 *   UPDATE_TEMPLATE_BASELINE=1 yarn test child-stack-templates
 * Then commit the updated fixtures alongside the code changes.
 */

import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as path from 'path';
import { MailboxDataStack } from '../data/mailbox-data-stack';
import { MailboxEdgeStack } from '../edge/mailbox-edge-stack';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');
const DATA_STACK_FIXTURE = path.join(FIXTURE_DIR, 'mailbox-data-stack-template.json');
const EDGE_STACK_FIXTURE = path.join(FIXTURE_DIR, 'mailbox-edge-stack-template.json');

/**
 * Normalize template for comparison by removing/replacing volatile fields.
 * Returns the full template for byte-equality comparison.
 */
function normalizeTemplate(template: Record<string, any>): Record<string, any> {
  // Deep clone
  const normalized = JSON.parse(JSON.stringify(template));

  // Remove or normalize volatile fields that may vary run-to-run
  // but don't affect the functional identity
  if (normalized.Metadata) {
    // CDK metadata is not deployed and shouldn't affect the gate
    delete normalized.Metadata;
  }

  return normalized;
}

describe('Child-Stack Template Baselines — Data & Edge', () => {
  describe('MailboxDataStack', () => {
    it('synthesizes to a template matching the baseline', () => {
      if (!fs.existsSync(FIXTURE_DIR)) {
        fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      }

      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack).toJSON();
      const normalized = normalizeTemplate(template);

      const shouldUpdate = process.env.UPDATE_TEMPLATE_BASELINE === '1';

      if (shouldUpdate) {
        fs.writeFileSync(DATA_STACK_FIXTURE, JSON.stringify(normalized, null, 2));
        console.log(`Updated MailboxDataStack template baseline: ${DATA_STACK_FIXTURE}`);
        return;
      }

      if (!fs.existsSync(DATA_STACK_FIXTURE)) {
        throw new Error(
          `Baseline fixture not found: ${DATA_STACK_FIXTURE}\n` +
          `Run: UPDATE_TEMPLATE_BASELINE=1 yarn test child-stack-templates`,
        );
      }

      const baseline = JSON.parse(fs.readFileSync(DATA_STACK_FIXTURE, 'utf-8'));
      const currentStr = JSON.stringify(normalized);
      const baselineStr = JSON.stringify(baseline);

      if (currentStr !== baselineStr) {
        const currentLines = currentStr.split('\n');
        const baselineLines = baselineStr.split('\n');
        const diffs: string[] = [];

        for (let i = 0; i < Math.max(currentLines.length, baselineLines.length); i++) {
          if (currentLines[i] !== baselineLines[i]) {
            diffs.push(`Line ${i + 1}:`);
            diffs.push(`  - ${baselineLines[i]}`);
            diffs.push(`  + ${currentLines[i]}`);
            if (diffs.length > 50) {
              diffs.push('... (truncated)');
              break;
            }
          }
        }

        throw new Error(
          `MailboxDataStack template mismatch:\n` +
          `Run: UPDATE_TEMPLATE_BASELINE=1 yarn test child-stack-templates\n` +
          `to review and commit changes.\n\n` +
          `Diff:\n${diffs.join('\n')}`,
        );
      }

      expect(true).toBe(true);
    });
  });

  describe('MailboxEdgeStack', () => {
    it('synthesizes to a template matching the baseline', () => {
      if (!fs.existsSync(FIXTURE_DIR)) {
        fs.mkdirSync(FIXTURE_DIR, { recursive: true });
      }

      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack).toJSON();
      const normalized = normalizeTemplate(template);

      const shouldUpdate = process.env.UPDATE_TEMPLATE_BASELINE === '1';

      if (shouldUpdate) {
        fs.writeFileSync(EDGE_STACK_FIXTURE, JSON.stringify(normalized, null, 2));
        console.log(`Updated MailboxEdgeStack template baseline: ${EDGE_STACK_FIXTURE}`);
        return;
      }

      if (!fs.existsSync(EDGE_STACK_FIXTURE)) {
        throw new Error(
          `Baseline fixture not found: ${EDGE_STACK_FIXTURE}\n` +
          `Run: UPDATE_TEMPLATE_BASELINE=1 yarn test child-stack-templates`,
        );
      }

      const baseline = JSON.parse(fs.readFileSync(EDGE_STACK_FIXTURE, 'utf-8'));
      const currentStr = JSON.stringify(normalized);
      const baselineStr = JSON.stringify(baseline);

      if (currentStr !== baselineStr) {
        const currentLines = currentStr.split('\n');
        const baselineLines = baselineStr.split('\n');
        const diffs: string[] = [];

        for (let i = 0; i < Math.max(currentLines.length, baselineLines.length); i++) {
          if (currentLines[i] !== baselineLines[i]) {
            diffs.push(`Line ${i + 1}:`);
            diffs.push(`  - ${baselineLines[i]}`);
            diffs.push(`  + ${currentLines[i]}`);
            if (diffs.length > 50) {
              diffs.push('... (truncated)');
              break;
            }
          }
        }

        throw new Error(
          `MailboxEdgeStack template mismatch:\n` +
          `Run: UPDATE_TEMPLATE_BASELINE=1 yarn test child-stack-templates\n` +
          `to review and commit changes.\n\n` +
          `Diff:\n${diffs.join('\n')}`,
        );
      }

      expect(true).toBe(true);
    });
  });
});
