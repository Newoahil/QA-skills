// QA Guardian — Feishu interactive card builder (§11B.5 notify upgrade)
//
// Pure builder: given a gate state + the safe notify payload (issue# / stage / link / reason),
// produce a Feishu interactive card JSON. Buttons carry a minimal, machine-parseable value
// { issue, verb } that the callback server (feishu-callback.mjs) translates into a
// `/guardian <verb> <text>` GitHub comment. revise/rework buttons open a text input so the
// human's opinion travels with the callback — no need to go to GitHub to type it.
//
// SAFETY: the card body contains ONLY issue#/stage/link/reason/short text — never code or
// secrets. This mirrors notify.mjs assertSafeBody discipline.

// Card actions per waiting/terminal state. Each verb maps 1:1 to a /guardian command.
// `input` verbs render a text field (revise/rework carry an opinion); plain verbs are buttons.
export const CARD_ACTIONS = Object.freeze({
  GATE_1_WAIT: [
    { verb: 'approve', label: '批准', type: 'primary', input: false },
    { verb: 'revise', label: '修改方案', type: 'default', input: true },
    { verb: 'reject', label: '拒绝', type: 'danger', input: false },
  ],
  GATE_2_WAIT: [
    { verb: 'rework', label: '打回重修', type: 'default', input: true },
  ],
  DONE: [
    { verb: 'followup', label: '提交新验收问题', type: 'primary', input: true },
  ],
  STALLED: [
    { verb: 'retry', label: '重试', type: 'primary', input: false },
  ],
  HANDED_BACK: [
    { verb: 'retry', label: '重新处理', type: 'primary', input: false },
  ],
});

const STATE_TITLE = Object.freeze({
  GATE_1_WAIT: 'QA Guardian · 闸门 1 · 需人工确认方案',
  GATE_2_WAIT: 'QA Guardian · 闸门 2 · PR 待人工评审',
  DONE: 'QA Guardian · 已完成 · 可提交新验收问题',
  STALLED: 'QA Guardian · 处理停滞 · 需关注',
  HANDED_BACK: 'QA Guardian · 已交回 · 等待人工',
});

const STATE_HEADER_TEMPLATE = Object.freeze({
  GATE_1_WAIT: 'orange',
  GATE_2_WAIT: 'blue',
  DONE: 'green',
  STALLED: 'yellow',
  HANDED_BACK: 'grey',
});

function textEl(content) {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

// Build one action element. Plain verb → button. Input verb → an input whose confirm submits
// the typed value alongside { issue, verb }. Callback value is always machine-parseable.
function actionElement(issue, action) {
  const value = { issue: Number(issue), verb: action.verb };
  if (action.input) {
    return {
      tag: 'input',
      name: `guardian_${action.verb}`,
      placeholder: { tag: 'plain_text', content: `填写${action.label}意见（将作为 /guardian ${action.verb} 的内容）` },
      confirm: {
        title: { tag: 'plain_text', content: `确认${action.label}` },
        text: { tag: 'plain_text', content: `将以你填写的内容执行 /guardian ${action.verb}` },
      },
      button: {
        tag: 'button',
        text: { tag: 'plain_text', content: action.label },
        type: action.type,
        value,
      },
      value,
    };
  }
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: action.label },
    type: action.type,
    value,
  };
}

/**
 * Build a Feishu interactive card for a gate/stall/handback notification.
 * @param {object} payload safe notify payload { issue, stage, link?, reason?, text? }
 * @returns {object} Feishu interactive card JSON (msg_type: interactive)
 */
export function buildFeishuCard(payload) {
  const state = payload.stage;
  const actions = CARD_ACTIONS[state] ?? [];
  const issue = Number(payload.issue);

  const bodyLines = [`**Issue** #${issue}`, `**阶段** ${state}`];
  if (payload.reason) bodyLines.push(`**原因** ${payload.reason}`);

  const elements = [textEl(bodyLines.join('\n'))];
  if (payload.link) {
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '查看 GitHub' },
          type: 'default',
          url: payload.link,
        },
      ],
    });
  }
  const actionEls = actions.map((a) => actionElement(issue, a));
  if (actionEls.length > 0) {
    elements.push({ tag: 'action', actions: actionEls });
  }

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: STATE_TITLE[state] ?? `QA Guardian · ${state}` },
        template: STATE_HEADER_TEMPLATE[state] ?? 'blue',
      },
      elements,
    },
  };
}

// Verbs a callback is allowed to translate into a /guardian command, per source state.
// Mirrors CARD_ACTIONS so the callback server can reject any verb not offered by the card.
export const ALLOWED_CALLBACK_VERBS = Object.freeze(
  Array.from(new Set(Object.values(CARD_ACTIONS).flat().map((a) => a.verb))),
);
