/**
 * Standalone sub-stack account-literal regression gate.
 *
 * Defect class: `Stack.of(this).account` / `Stack.of(this).region` resolve to a LITERAL string
 * whenever the stack has an explicit `env` — unlike `Aws.ACCOUNT_ID` / `Aws.REGION`, which always
 * produce the `{"Ref":"AWS::AccountId"}` / `{"Ref":"AWS::Region"}` token. The two forms are visually
 * identical at the call site, tsc/jsii can't see the difference, and every other unit test in this
 * package also passes an explicit `env` — so this is the one place a literal leak is observable at
 * all: the synthesized template of a stack built exactly the way the standalone builders build it.
 *
 * `tools/build-data-stack.ts` / `tools/build-edge-stack.ts` synthesize MailboxDataStack /
 * MailboxEdgeStack with an explicit `env` (falling back to CDK_DEFAULT_ACCOUNT, or the literal
 * '000000000000' when that's unset) and publish the resulting template as a public artifact. This
 * test mirrors that construction — same stack classes, same `env` shape, same
 * `BootstraplessSynthesizer` — with a distinctive fake account standing in for "a real account
 * leaked", and scans the ENTIRE serialized template (not selected properties) for any 12-digit
 * account-number-shaped literal that isn't the known, separately-tracked placeholder.
 *
 * MailboxDataStack: Exempted findings from utils/named-table.ts and mailbox-cdk-shared/named-bucket.ts
 * embedding the concrete account in construct ids are filtered by `isPostponedNamedResource` until the
 * owner lands the named-resource change.
 */
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { MailboxDataStack }              from '../core/data/mailbox-data-stack';
import { MailboxEdgeStack }              from '../core/edge/mailbox-edge-stack';

// Stand-in for "a real customer account leaked into a published template" — distinctive so it can
// never be confused with a legitimate value, and never a real account number.
const FAKE_ACCOUNT = '111122223333';

// TEMPORARY exemption. The data stack's logical ids/tag values currently bake in the
// CDK_DEFAULT_ACCOUNT fallback placeholder '000000000000' as a separate, already-known defect that
// is being fixed elsewhere (logical-id rework). Delete this constant and its use below once that
// work lands — at that point the scan should tolerate zero account-shaped literals.
const KNOWN_PLACEHOLDER_ACCOUNT = '000000000000';

// TEMPORARY exemption, owner-postponed: StackNamedTable (utils/named-table.ts) and named-bucket
// (mailbox-cdk-shared) embed the concrete account in construct ids, which leaks into logical ids,
// Ref/GetAtt targets and the name tag. Fixing it replaces deployed data resources, so it lands with
// the named-resource change — delete this exemption in that change.
const POSTPONED_NAMED_RESOURCES = ['blob-store', 'config-table', 'item-table', 'changelog-table', 'auditlog-table', 'mailfeedback-table'];

interface AccountLiteralViolation {
  path: string;
  value: string;
}

/** Matches a bare 12-digit run (an AWS account id is always exactly 12 digits). */
const ACCOUNT_SHAPED_LITERAL = /\d{12}/g;

/**
 * Walks every string value in a synthesized template (object/array/scalar tree, as produced by
 * `assembly.getStackArtifact(...).template`) and reports any account-shaped 12-digit literal not in
 * `allowed` — scanning logical ids, property values, and tag values alike, since the leak in
 * question shows up in exactly those places and a property-targeted assertion would miss it.
 */
function findAccountLiterals(node: unknown, allowed: ReadonlySet<string>, path = '$'): AccountLiteralViolation[] {
  const violations: AccountLiteralViolation[] = [];

  if (typeof node === 'string') {
    const matches = node.match(ACCOUNT_SHAPED_LITERAL) ?? [];
    for (const match of matches) {
      if (!allowed.has(match)) {
        violations.push({ path, value: node });
      }
    }
    return violations;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      violations.push(...findAccountLiterals(item, allowed, `${path}[${index}]`));
    });
    return violations;
  }

  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      violations.push(...findAccountLiterals(value, allowed, `${path}.${key}`));
    }
    // Logical resource ids are the object KEYS one level up (e.g. Resources.<LogicalId>), not
    // values — scan them too so a leaked account baked into a logical id is caught.
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const matches = key.match(ACCOUNT_SHAPED_LITERAL) ?? [];
      for (const match of matches) {
        if (!allowed.has(match)) {
          violations.push({ path: `${path}.${key}`, value: key });
        }
      }
    }
    return violations;
  }

  return violations;
}

/**
 * Fails with a message naming every violation's JSON path and value — a bare `toEqual([])` diff is
 * legible for a couple of entries but this makes the location report explicit regardless of count.
 */
function assertNoAccountLiterals(violations: AccountLiteralViolation[], stackLabel: string): void {
  if (violations.length === 0) {return;}
  const report = violations.map((v) => `  ${v.path} = ${JSON.stringify(v.value)}`).join('\n');
  throw new Error(`Account-literal leak found in ${stackLabel} template (${violations.length} occurrence(s)):\n${report}`);
}

/**
 * Checks whether a value matches one of the postponed named-resource findings.
 * Matches either:
 * - tag value pattern: `${FAKE_ACCOUNT}-mailboxdata-${name}` (e.g. `111122223333-mailboxdata-blob-store`)
 * - logical ID pattern: `${FAKE_ACCOUNT}mailboxdata${nameWithoutHyphens}(Policy)?[0-9A-F]{8}`
 *   (e.g. `111122223333mailboxdatablobstorePolicy1a2b3c4d`)
 */
function isPostponedNamedResource(value: string): boolean {
  for (const name of POSTPONED_NAMED_RESOURCES) {
    const nameWithoutHyphens = name.replace(/-/g, '');

    // Match tag value pattern: ${FAKE_ACCOUNT}-mailboxdata-${name}
    if (value === `${FAKE_ACCOUNT}-mailboxdata-${name}`) {
      return true;
    }

    // Match logical ID pattern: ^${FAKE_ACCOUNT}mailboxdata${nameWithoutHyphens}(Policy)?[0-9A-F]{8}$
    const logicalIdPattern = new RegExp(
      `^${FAKE_ACCOUNT}mailboxdata${nameWithoutHyphens}(Policy)?[0-9A-F]{8}$`,
      'i'
    );
    if (logicalIdPattern.test(value)) {
      return true;
    }
  }
  return false;
}

describe('Standalone sub-stack account-literal leak (regression gate)', () => {
  it('MailboxDataStack, synthesized like tools/build-data-stack.ts, leaks no real account literal', () => {
    const app   = new App();
    const stack = new MailboxDataStack(app, 'MailboxData', {
      env: {
        account: FAKE_ACCOUNT,
        region: 'eu-west-1',
      },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const assembly = app.synth();
    const artifact = assembly.getStackArtifact(stack.artifactId);
    const template = artifact.template;

    const violations = findAccountLiterals(template, new Set([KNOWN_PLACEHOLDER_ACCOUNT]))
      .filter(v => !isPostponedNamedResource(v.value));

    assertNoAccountLiterals(violations, 'MailboxDataStack');
  });

  it('MailboxEdgeStack, synthesized like tools/build-edge-stack.ts, leaks no real account literal', () => {
    const app   = new App();
    const stack = new MailboxEdgeStack(app, 'MailboxEdge', {
      env: {
        account: FAKE_ACCOUNT,
        region: 'us-east-1',
      },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const assembly = app.synth();
    const artifact = assembly.getStackArtifact(stack.artifactId);
    const template = artifact.template;

    const violations = findAccountLiterals(template, new Set([KNOWN_PLACEHOLDER_ACCOUNT]));

    assertNoAccountLiterals(violations, 'MailboxEdgeStack');
  });
});
