// Local Feishu WebSocket transport.
// The official SDK owns connection authentication and callback verification. This module only
// maps card.action.trigger into the shared normalized action executor.

import { parseCardAction } from './feishu-callback.mjs';
import { executeNormalizedAction } from './action-executor.mjs';

export const CARD_ACTION_EVENT = 'card.action.trigger';

function eventIdOf(data) {
  return data?.header?.event_id ?? data?.event_id ?? data?.uuid ?? null;
}

function actionResultText(result) {
  if (result?.deduped) return '该操作已处理';
  return `已提交 /guardian ${result.verb}`;
}

/**
 * Create the local Feishu WS runtime. SDK is injectable for tests; production dynamically loads
 * @larksuiteoapi/node-sdk so scheduler-only mode does not require the optional dependency.
 * @param {object} args { appId, appSecret, repo, seen, postComment, sdk?, logger? }
 */
export async function createFeishuWsRuntime(args) {
  const sdk = args.sdk ?? await import('@larksuiteoapi/node-sdk');
  const logger = args.logger ?? console;
  const wsClient = new sdk.WSClient({
    appId: args.appId,
    appSecret: args.appSecret,
    autoReconnect: true,
    logger,
  });

  const eventDispatcher = new sdk.EventDispatcher({}).register({
    [CARD_ACTION_EVENT]: async (data) => {
      try {
        const cmd = parseCardAction(data);
        const result = await executeNormalizedAction({
          eventId: eventIdOf(data),
          cmd,
          repo: args.repo,
          seen: args.seen,
          postComment: args.postComment,
        });
        return { toast: { type: 'success', content: actionResultText(result) } };
      } catch (error) {
        const message = error instanceof Error ? error.message : '操作失败';
        logger.error?.(`[feishu-ws] card action rejected: ${message}`);
        return { toast: { type: 'fail', content: '操作未提交，请查看 scheduler 日志' } };
      }
    },
  });

  let started = false;
  return {
    start() {
      if (started) return;
      started = true;
      wsClient.start({ eventDispatcher });
    },
    close() {
      const close = wsClient.close ?? wsClient.stop;
      if (typeof close === 'function') return close.call(wsClient);
      return undefined;
    },
    client: wsClient,
    eventDispatcher,
  };
}
