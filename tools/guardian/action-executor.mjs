// Shared Feishu action -> GitHub comment executor.
// Both HTTP and WebSocket transports use this path so validation, deduplication, and the
// command text cannot drift between transports.

import { commandToCommentBody } from './feishu-callback.mjs';

/**
 * @param {object} args { eventId, cmd, repo, seen, postComment }
 * @returns {Promise<{issue:number,verb:string,text:string,comment:{id:number,url:string}} | {deduped:true}>}
 */
export async function executeNormalizedAction(args) {
  const { eventId, cmd, repo, seen, postComment } = args;
  if (eventId && seen.has(eventId)) return { deduped: true };
  if (eventId) seen.add(eventId);
  try {
    const comment = await postComment(repo, cmd.issue, commandToCommentBody(cmd));
    return { issue: cmd.issue, verb: cmd.verb, text: cmd.text, comment };
  } catch (error) {
    if (eventId) seen.delete(eventId);
    throw error;
  }
}
