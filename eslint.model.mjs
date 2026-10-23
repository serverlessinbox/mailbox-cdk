import ts from 'typescript-eslint';

// G-model lint: where the covered resource kinds, IAM statements and logical-ID pins live
// (R1, R2 and R4; R3, the events import rule, is in eslint.boundary.mjs with the other import rules;
// R5, the sweeper removal boundary, is at the end of this file).
// ESLint flat config replaces `no-restricted-syntax` per file, so each file group below gets the
// selector list of its own: every selector minus the ones the group is allowed to use.

const sources = ['packages/mailbox/src', 'packages/mailbox-cognito/src', 'packages/mailbox-cdk-shared/src'];
const outsideRules = sources.flatMap((src) => [`${src}/runtime/**`, `${src}/**/__tests__/**`]);

// R1: the covered kinds. Each kind folder may create its own classes; the member form
// (`new dynamodb.Table(...)`) and the identifier form (`new Table(...)`) are both matched.
const kindFolders = {
  tables: ['Table', 'StackNamedTable', 'BaseTable'],
  queues: ['Queue', 'BaseQueue'],
  buckets: ['Bucket', 'StackNamedBucket'],
  topics: ['Topic'],
  events: ['Rule', 'EventSourceMapping', 'LambdaFunction'],
  workflows: ['StateMachine'],
};

const classSelector = (name) => `NewExpression[callee.name='${name}'], NewExpression[callee.property.name='${name}']`;

const coveredKindSelectors = (kind) => [
  ...kindFolders[kind].map((name) => ({
    selector: classSelector(name),
    message: `G-model R1: new ${name} belongs in resources/${kind}/ as a defined resource, not here.`,
  })),
];

// `Function` is matched bare or through the aws-lambda namespace only: other services have a `Function` too.
const lambdaFunctionSelector = {
  selector: "NewExpression[callee.name='Function'], NewExpression[callee.object.name=/^(lambda|aws_lambda)$/][callee.property.name='Function']",
  message: 'G-model R1: new lambda.Function belongs in resources/lambdas/ as a Lambda wrapper, not here.',
};

const selectorsOfKind = {
  ...Object.fromEntries(Object.keys(kindFolders).map((kind) => [kind, coveredKindSelectors(kind)])),
  lambdas: [lambdaFunctionSelector],
};

const kindSelectorsExcept = (kind) =>
  Object.entries(selectorsOfKind)
    .filter(([name]) => name !== kind)
    .flatMap(([, selectors]) => selectors);

// R2: IAM statements are written in resources/**, the kit's grants/** helpers and the allow-list below.
const iamMessage = 'G-model R2: IAM statements live in resources/** (a grant method of the defined resource), in the kit grants/** helpers, or in a file on the R2 allow-list of eslint.model.mjs.';
const iamSelectors = [
  { selector: "NewExpression[callee.name='PolicyStatement'], NewExpression[callee.property.name='PolicyStatement']", message: iamMessage },
  { selector: "NewExpression[callee.name='Policy'], NewExpression[callee.property.name='Policy']", message: iamMessage },
  { selector: "CallExpression[callee.property.name='addToRolePolicy']", message: iamMessage },
  { selector: "CallExpression[callee.property.name='addToPrincipalPolicy']", message: iamMessage },
];

// The only justifications allowed: the construct owns an explicit role, or the construct grants on a
// non-covered target. The sweeper's own files are listed in sweeperIamAllowList below.
const iamAllowList = [
  // Non-covered target: the Cognito user pool's own grantAdminAccess method.
  'packages/mailbox-cognito/src/user-pool/mailbox-user-pool.ts',
  // Non-covered target: the WebSocket API's own grantManageConnections method.
  'packages/mailbox/src/core/apis/websocket.ts',
  // Explicit role: the stack-failure detector's one named policy on its pre-created role.
  'packages/mailbox/src/platform/ops/stack-failure-detection-infra.ts',
  // Explicit roles: the support hop role and the support tier roles with their policies.
  'packages/mailbox/src/platform/support/support-roles-infra.ts',
];

// The sweeper folder's allow-listed files (iam-scoping section 0). Sanctioned removal plugins own their
// IAM statements there; the sweeper's explicit roles keep theirs. These files are exempt from R5 as well,
// because the sweeper folder is where removal implementations live.
const sweeperIamAllowList = [
  // Sanctioned removal plugins: each removal type owns its IAM statements.
  'packages/mailbox/src/platform/ops/sweeper/*-removal.ts',
  // Explicit role: the sweeper's execution role statements, shared by its inline policy and its permissions boundary.
  'packages/mailbox/src/platform/ops/sweeper/sweeper-execution-grants.ts',
  // Explicit roles: the sweeper's execution and worker roles with their named policies.
  'packages/mailbox/src/platform/ops/sweeper/sweeper-infra.ts',
];

// R4: a logical-ID pin is written by a Stack class, or by the one allow-listed file.
const stackAncestors = ["ClassDeclaration[superClass.name=/^(Stack|NestedStack)$/] *", "ClassDeclaration[superClass.property.name=/^(Stack|NestedStack)$/] *"];
const logicalIdSelector = {
  selector: `CallExpression[callee.property.name='overrideLogicalId']:not(${stackAncestors.join(', ')})`,
  message: 'G-model R4: overrideLogicalId is written by a Stack class, or by the one allow-listed file in eslint.model.mjs that pins an externally unique resource.',
};

// The admin API, JMAP API and WebSocket push custom domains are externally unique and have carried
// these literal IDs on every install since before the restructure (L-242, mailbox.fixed-identity.test.ts).
const logicalIdAllowList = ['packages/mailbox/src/core/apis/apis-section.ts'];

// R5: a resource-removal implementation lives in platform/ops/sweeper/ only. The sweeper folder is the one
// place these selectors do not apply; every other file of the sources gets them with the rest of R1-R4.
// Matches a class `implements` clause naming IResourceRemoval, bare or qualified (X.IResourceRemoval), and a
// grantStatements() definition in a file that also names PolicyStatement.
const removalSelectors = [
  {
    selector: 'TSClassImplements[expression.name="IResourceRemoval"]',
    message: 'G-model R5: a class implementing IResourceRemoval lives only in platform/ops/sweeper/.',
  },
  {
    selector: 'TSClassImplements > :matches(TSQualifiedName[right.name="IResourceRemoval"], MemberExpression[property.name="IResourceRemoval"])',
    message: 'G-model R5: a class implementing a qualified IResourceRemoval lives only in platform/ops/sweeper/.',
  },
  {
    selector: 'Program:has(:matches(MethodDefinition, TSAbstractMethodDefinition, TSMethodSignature, Property)[key.name="grantStatements"]):has(Identifier[name="PolicyStatement"])',
    message: 'G-model R5: a grantStatements() method next to a PolicyStatement lives only in platform/ops/sweeper/.',
  },
];

const sweeperFiles = ['packages/mailbox/src/platform/ops/sweeper/**/*.ts'];

const allKindSelectors = kindSelectorsExcept(undefined);
const everywhere = [...allKindSelectors, ...iamSelectors, logicalIdSelector];
const restrictedSyntax = (selectors) => ({ 'no-restricted-syntax': ['error', ...selectors] });

const underResources = (path) => sources.map((src) => `${src}/resources/${path}`);

export const modelConfig = [
  {
    files: sources.map((src) => `${src}/**/*.ts`),
    ignores: [...outsideRules, ...sweeperFiles],
    languageOptions: { parser: ts.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: restrictedSyntax([...everywhere, ...removalSelectors]),
  },
  {
    // The sweeper folder keeps every model selector except R5.
    files: sweeperFiles,
    ignores: outsideRules,
    languageOptions: { parser: ts.parser },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
    rules: restrictedSyntax(everywhere),
  },
  {
    files: underResources('**/*.ts'),
    ignores: outsideRules,
    rules: restrictedSyntax([...allKindSelectors, logicalIdSelector, ...removalSelectors]),
  },
  ...[...Object.keys(selectorsOfKind)].map((kind) => ({
    files: underResources(`${kind}/**/*.ts`),
    ignores: outsideRules,
    rules: restrictedSyntax([...kindSelectorsExcept(kind), logicalIdSelector, ...removalSelectors]),
  })),
  {
    files: sources.map((src) => `${src}/grants/**/*.ts`),
    ignores: outsideRules,
    rules: restrictedSyntax([...allKindSelectors, logicalIdSelector, ...removalSelectors]),
  },
  {
    files: iamAllowList,
    ignores: outsideRules,
    rules: restrictedSyntax([...allKindSelectors, logicalIdSelector, ...removalSelectors]),
  },
  {
    files: sweeperIamAllowList,
    ignores: outsideRules,
    rules: restrictedSyntax([...allKindSelectors, logicalIdSelector]),
  },
  {
    files: logicalIdAllowList,
    ignores: outsideRules,
    rules: restrictedSyntax([...allKindSelectors, ...iamSelectors, ...removalSelectors]),
  },
];
