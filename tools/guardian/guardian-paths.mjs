// QA Guardian — shared filesystem path helpers.
//
// Extracted (P0 refactor, batch 2) so scheduler.mjs and scheduler-discovery.mjs can share the
// same guardian-dir resolution without a circular import. Single source of truth for the
// `.qa/guardian` directory layout.

import path from 'node:path';

export function guardianDirOf(repoDir) {
  return path.join(repoDir, '.qa', 'guardian');
}
