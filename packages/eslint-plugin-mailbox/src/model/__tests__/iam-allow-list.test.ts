import { globSync }     from 'node:fs';
import path             from 'node:path';

import { iamAllowList } from '../iam-allow-list';

// Pins the R2 allow-list: each entry is justified and names a file that exists, and the list may only shrink.

const repoRoot         = path.resolve(__dirname, '../../../../..');
const pinnedEntryCount = 7;

describe('iamAllowList', () => {
  it('does not grow beyond the pinned entry count', () => {
    expect(iamAllowList.length).toBeLessThanOrEqual(pinnedEntryCount);
  });

  it('gives every entry a reason', () => {
    for (const entry of iamAllowList) {
      expect(entry.reason.trim()).not.toBe('');
    }
  });

  it('names an existing file for every entry', () => {
    for (const entry of iamAllowList) {
      expect(globSync(entry.path, { cwd: repoRoot })).not.toHaveLength(0);
    }
  });
});
