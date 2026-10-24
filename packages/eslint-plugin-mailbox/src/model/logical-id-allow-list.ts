export interface LogicalIdAllowListEntry {
  readonly path:   string;
  readonly reason: string;
}

// Files that may pin a logical ID outside a Stack class. The list may only shrink.
export const logicalIdAllowList: readonly LogicalIdAllowListEntry[] = [
  {
    path:   'packages/mailbox/src/core/apis/apis-section.ts',
    reason: 'Externally unique custom domains (admin API, JMAP API, WebSocket push) whose literal logical IDs are fixed on every install.',
  },
];
