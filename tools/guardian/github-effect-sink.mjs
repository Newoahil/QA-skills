// QA Guardian — GitHub-backed EffectSink implementation.

import { assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { createEffectSink, effectResult } from './effect-sink.mjs';
import { defaultGhComment, defaultCurlPost } from './notify-io.mjs';
import { projectLabels } from './label-io.mjs';
import { createPullRequest } from './pr-io.mjs';

export function createGitHubEffectSink({ repoDir, io = {} }) {
  const ghComment = io.ghComment ?? ((issue, text, actor) => defaultGhComment(repoDir, actor)(issue, text));
  const curlPost = io.curlPost ?? ((url, body, actor) => defaultCurlPost(actor)(url, body));
  const labelProjector = io.projectLabels ?? projectLabels;
  const prCreator = io.createPullRequest ?? createPullRequest;

  return createEffectSink((descriptor) => {
    assertActorMayPerform(descriptor.actor, descriptor.kind);
    return normalizeDispatchResult(dispatchGitHubEffect({ repoDir, descriptor, ghComment, curlPost, labelProjector, prCreator }));
  });
}

function normalizeDispatchResult(result) {
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result;
  return effectResult(result);
}

function dispatchGitHubEffect({ repoDir, descriptor, ghComment, curlPost, labelProjector, prCreator }) {
  const { actor, kind, payload } = descriptor;
  switch (kind) {
    case EFFECTS.FACT_COMMENT:
      return ghComment(payload.issue, payload.text, actor);
    case EFFECTS.FACT_WEBHOOK:
      return curlPost(payload.url, payload.body, actor);
    case EFFECTS.LABEL:
      return labelProjector(repoDir, payload.issue, payload.record, payload.run, actor);
    case EFFECTS.PR_CREATE:
      return prCreator({ repoDir, actor, head: payload.head, base: payload.base, title: payload.title, body: payload.body, run: payload.run });
    default:
      throw new Error(`unsupported GitHub effect kind: ${String(kind)}`);
  }
}
