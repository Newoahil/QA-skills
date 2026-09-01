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
    expectedTaskTypes: ['qa-e2e', 'qa-cr'],
    requiresPlaywrightModule: true,
    requireE2ERunnerResult: true,
    expectedRunnerStatus: 'FAIL',
    expectedRunnerTestExitCode: 1,
    expectedRunnerCleanupOk: true,
    assertPortBindableAfterRun: true,
    requiredEvidenceTerms: ['E2E_RUN_RESULT', 'duplicate-submit=2', 'src/ui/submit.mjs', 'testExitCode', 'browser=chromium'],
    requiredAnyEvidenceTerms: ['in-flight', 'lock', 'duplicate submit', 'second immediate submission', 'playwright-module=', 'url=http://127.0.0.1:'],
    forbiddenToolInputTerms: ['.git', 'gitdir'],
    promptSummary: 'runtime-only duplicate submit requires bounded diagnostic before mandatory CR',
    makeFixture: ({ port, playwrightModulePath }) => ({
      baselineFiles: {
        'server.mjs': `
          import http from 'node:http';

          const port = Number(process.env.E2E_PORT || ${port});
          let submitCount = 0;

          const indexHtml = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./index.html', import.meta.url), 'utf8'));
          const submitModule = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./src/ui/submit.mjs', import.meta.url), 'utf8'));

          const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (req.method === 'GET' && url.pathname === '/healthz') {
              res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
              res.end('ok');
              return;
            }
            if (req.method === 'GET' && url.pathname === '/') {
              res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
              res.end(indexHtml);
              return;
            }
            if (req.method === 'GET' && url.pathname === '/src/ui/submit.mjs') {
              res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
              res.end(submitModule);
              return;
            }
            if (req.method === 'POST' && url.pathname === '/submit') {
              await new Promise((resolve) => setTimeout(resolve, 35));
              submitCount += 1;
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: true, submitCount }));
              return;
            }
            if (req.method === 'GET' && url.pathname === '/count') {
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ submitCount }));
              return;
            }
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
          });

          server.listen(port, '127.0.0.1');
        `,
        'index.html': `
          <!doctype html>
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Duplicate Submit Fixture</title>
              <style>
                button { animation: pulse 120ms ease-in-out; }
                @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.02); } }
              </style>
            </head>
            <body>
              <button id="submit-button">Submit</button>
              <script type="module">
                import { createSubmitController } from '/src/ui/submit.mjs';
                const button = document.getElementById('submit-button');
                const controller = createSubmitController({
                  send: () => fetch('/submit', { method: 'POST' }),
                });
                button.addEventListener('click', () => controller.handleClick());
                window.__qaDoubleClickProbe = async () => {
                  button.click();
                  button.click();
                  await new Promise((resolve) => setTimeout(resolve, 160));
                };
              </script>
            </body>
          </html>
        `,
        'src/ui/submit.mjs': `
          export function createSubmitController({ send }) {
            let inFlight = false;
            return {
              async handleClick() {
                if (inFlight) return 'blocked';
                inFlight = true;
                try {
                  await send();
                  return 'submitted';
                } finally {
                  setTimeout(() => { inFlight = false; }, 120);
                }
              },
            };
          }
        `,
        'check-duplicate-submit.mjs': `
          import { pathToFileURL } from 'node:url';

          const modulePath = process.env.QA_E2E_PLAYWRIGHT_MODULE;
          if (!modulePath) {
            console.error('Missing QA_E2E_PLAYWRIGHT_MODULE');
            process.exit(2);
          }
          const { chromium } = await import(pathToFileURL(modulePath).href);
          const browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          const baseUrl = 'http://127.0.0.1:' + (process.env.E2E_PORT || ${port});
          await page.goto(baseUrl + '/');
          await page.evaluate(async () => { await window.__qaDoubleClickProbe(); });
          await page.waitForTimeout(220);
          const countPayload = await page.evaluate(async (url) => fetch(url + '/count').then((response) => response.json()), baseUrl);
          const count = Number(countPayload.submitCount);
          console.log('browser=chromium');
          console.log('playwright-module=' + modulePath);
          console.log('url=' + baseUrl + '/');
          console.log('duplicate-submit=' + count);
          await browser.close();
          process.exit(count === 1 ? 0 : 1);
        `,
      },
      candidateFiles: {
        'src/ui/submit.mjs': `
          export function createSubmitController({ send }) {
            return {
              async handleClick() {
                await send();
                return 'submitted';
              },
            };
          }
        `,
      },
      prompt: [
        'Requirement: animation timing must not allow duplicate submit.',
        'Runtime observation is required to establish the trigger. First dispatch a bounded diagnostic qa-e2e, then still dispatch mandatory qa-cr; do not inline CR for this runtime/code relation.',
        'Use the materialized .opencode runner with start command node server.mjs, readiness URL http://127.0.0.1:' + port + '/healthz, allowExisting false, and test command node check-duplicate-submit.mjs.',
        'Pass E2E_PORT=' + port + ' and QA_E2E_PLAYWRIGHT_MODULE=' + playwrightModulePath + ' through config env, do not install anything, and keep the total runner budget practical and no more than 120000 ms.',
        'Return raw E2E_RUN_RESULT plus Playwright/browser evidence, then reconcile that runtime evidence with qa-cr reasoning about src/ui/submit.mjs and the in-flight lock.',
      ],
      touchedFiles: ['src/ui/submit.mjs'],
      verifierCommand: ['node', 'check-duplicate-submit.mjs'],
    }),
  },
];
