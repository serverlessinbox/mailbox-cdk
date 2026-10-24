export interface IamAllowListEntry {
  readonly path:   string;
  readonly reason: string;
}

// Files outside resources/** and grants/** that may write IAM statements. A path may be a glob whose `*`
// stays within one path segment. The list may only shrink.
export const iamAllowList: readonly IamAllowListEntry[] = [
  {
    path:   'packages/mailbox-cognito/src/user-pool/mailbox-user-pool.ts',
    reason: "Non-covered target: the Cognito user pool's own grantAdminAccess method.",
  },
  {
    path:   'packages/mailbox/src/core/apis/websocket.ts',
    reason: "Non-covered target: the WebSocket API's own grantManageConnections method.",
  },
  {
    path:   'packages/mailbox/src/platform/ops/stack-failure-detection-infra.ts',
    reason: "Explicit role: the stack-failure detector's one named policy on its pre-created role.",
  },
  {
    path:   'packages/mailbox/src/platform/support/support-roles-infra.ts',
    reason: 'Explicit roles: the support hop role and the support tier roles with their policies.',
  },
  {
    path:   'packages/mailbox/src/platform/ops/sweeper/*-removal.ts',
    reason: 'Sanctioned removal plugins: each removal type owns its IAM statements.',
  },
  {
    path:   'packages/mailbox/src/platform/ops/sweeper/sweeper-execution-grants.ts',
    reason: "Explicit role: the sweeper's execution role statements, shared by its inline policy and its permissions boundary.",
  },
  {
    path:   'packages/mailbox/src/platform/ops/sweeper/sweeper-infra.ts',
    reason: "Explicit roles: the sweeper's execution and worker roles with their named policies.",
  },
];
