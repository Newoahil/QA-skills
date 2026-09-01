export const pairedScenarios = [
  {
    id: 'login-style-clean',
    expectedStatus: 'PASS',
    forbidQaE2e: true,
    expectedTaskTypes: [],
    requiredEvidenceTerms: ['src/ui/login-panel.css', 'accent', 'verify-login-style.mjs'],
    forbiddenEvidenceTerms: ['src/auth/session.ts', 'issueSession', 'session-token'],
    forbiddenScopePaths: ['src/auth/session.ts'],
    promptSummary: 'login-named CSS-only change must stay scoped',
    makeFixture: ({ baseline, candidate }) => ({
      baselineFiles: {
        'src/ui/login-panel.css': '.login-panel { --accent: #2244aa; color: var(--accent); }\n',
        'src/ui/LoginPage.tsx': 'export function LoginPage() { return `<button class="login-panel">Login</button>`; }\n',
        'src/auth/session.ts': 'export function issueSession() { return "session-token"; }\n',
        'verify-login-style.mjs': 'console.log("OK css token only"); process.exit(0);\n',
      },
      candidateFiles: {
        'src/ui/login-panel.css': '.login-panel { --accent: #7c3aed; color: var(--accent); }\n',
      },
      prompt: [
        'Requirement: this change only updates one accent token on the login page and interaction/behavior must stay unchanged.',
        'Caller-supplied verifier: node verify-login-style.mjs returns exit 0 for the accepted candidate.',
      ],
      verifierCommand: ['node', 'verify-login-style.mjs'],
      touchedFiles: ['src/ui/login-panel.css'],
    }),
  },
  {
    id: 'login-style-shared-selector',
    expectedStatus: 'FAIL',
    forbidQaE2e: true,
    expectedTaskTypes: [],
    requiredEvidenceTerms: ['src/ui/shared.css', 'aria-disabled', 'pointer-events'],
    requiredAnyEvidenceTerms: ['BillingPage', 'LoginPage', 'shared selector', 'shared consumer'],
    promptSummary: 'shared selector breakage must expand beyond page name',
    makeFixture: () => ({
      baselineFiles: {
        'src/ui/shared.css': '.btn[aria-disabled="true"] { pointer-events: none; opacity: .5; }\n',
        'src/ui/LoginPage.tsx': 'export const login = `<button class="btn" aria-disabled="true">Login</button>`;\n',
        'src/ui/BillingPage.tsx': 'export const billing = `<button class="btn" aria-disabled="true">Pay</button>`;\n',
      },
      candidateFiles: {
        'src/ui/shared.css': '.btn[aria-disabled="true"] { pointer-events: auto; opacity: .5; }\n',
      },
      prompt: [
        'Requirement: disabled controls must remain non-interactive everywhere that shares the selector.',
        'Shared selectors or consumers matter only when evidence shows the relationship.',
      ],
      touchedFiles: ['src/ui/shared.css'],
    }),
  },
  {
    id: 'neutral-auth-helper',
    expectedStatus: 'FAIL',
    forbidQaE2e: true,
    expectedTaskTypes: [],
    requiredEvidenceTerms: ['src/helpers/formatValue.ts', 'src/session/audit.ts', 'src/session/index.ts'],
    requiredAnyEvidenceTerms: ['token', 'redact', 'redaction', 'mask', 'leak'],
    promptSummary: 'neutral helper must still expand via multi-hop auth relation',
    makeFixture: () => ({
      baselineFiles: {
        'src/helpers/formatValue.ts': 'export function formatValue(input) { return input.slice(0, 3) + "***"; }\n',
        'src/session/audit.ts': 'import { formatValue } from "../helpers/formatValue"; export function auditToken(token) { return `audit:${formatValue(token)}`; }\n',
        'src/session/index.ts': 'import { auditToken } from "./audit"; export function recordSession(token) { return auditToken(token); }\n',
      },
      candidateFiles: {
        'src/helpers/formatValue.ts': 'export function formatValue(input) { return input; }\n',
      },
      prompt: [
        'Requirement: session/token audit logs must keep tokens redacted.',
        'The changed file name is intentionally neutral and does not prove irrelevance.',
      ],
      touchedFiles: ['src/helpers/formatValue.ts'],
    }),
  },
  {
    id: 'linked-worktree',
    expectedStatus: 'PASS',
    forbidQaE2e: true,
    expectedTaskTypes: [],
    requiredEvidenceTerms: ['src/ui/status.ts', 'ready-now'],
    requiredAnyEvidenceTerms: ['Evidence:', 'Findings:', 'Limits:'],
    forbiddenToolInputTerms: ['.git', 'gitdir'],
    promptSummary: 'caller-supplied HEAD/diff should avoid external .git traversal',
    makeFixture: () => ({
      baselineFiles: {
        'src/ui/status.ts': 'export const status = "ready";\n',
      },
      candidateFiles: {
        'src/ui/status.ts': 'export const status = "ready-now";\n',
      },
      prompt: [
        'Requirement: current status text must become ready-now; caller already supplies HEAD and diff.',
      ],
      touchedFiles: ['src/ui/status.ts'],
      useWorktree: true,
    }),
  },
  {
    id: 'animation-duplicate-submit',
    expectedStatus: 'FAIL',
    expectedTaskTypes: ['qa-e2e'],
    optionalEnv: 'QA_ORCHESTRATOR_E2E_FIXTURE',
    skipReason: 'set QA_ORCHESTRATOR_E2E_FIXTURE=1 to run the local runtime diagnostic/e2e fixture; this scenario still needs a real browser/runtime before it is an acceptance gate',
    promptSummary: 'runtime-only duplicate submit requires bounded diagnostic before mandatory CR',
    makeFixture: () => ({
      baselineFiles: {
        'src/ui/submit.ts': 'export function submitState() { return { locked: true, animationMs: 120 }; }\n',
        'tests/runtime/duplicate-submit-note.txt': 'runtime diagnostic fixture required\n',
      },
      candidateFiles: {
        'src/ui/submit.ts': 'export function submitState() { return { locked: false, animationMs: 120 }; }\n',
      },
      prompt: [
        'Requirement: animation timing must not allow duplicate submit.',
        'If runtime observation is needed to establish the trigger, gather bounded diagnostic evidence first, then still complete CR.',
      ],
      touchedFiles: ['src/ui/submit.ts'],
    }),
  },
];
