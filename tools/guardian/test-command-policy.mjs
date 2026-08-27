import path from 'node:path';

// A scoped node test target is either (a) a file under a tests/test/__tests__ directory segment, or
// (b) a file whose basename follows a test naming convention (test-*, *.test.*, *.spec.*). The latter
// covers monorepos like frontend/apps/*/scripts/test-*.js where regression tests live beside build
// scripts. A bare src/ directory is intentionally NOT a test root (its files are product source);
// only a test-named file under src/ qualifies. repoRelativePath() already blocks traversal/absolute.
const NODE_TEST_PATH = /(?:(?:^|[\/])(?:tests?|__tests__)[\/].+|(?:^|[\/])(?:test-[^\/]+|[^\/]+\.(?:test|spec)))\.(?:mjs|js|cjs|ts|tsx|jsx)$/;
const PYTHON_TEST_FILE = /(?:(?:^|[\/])(?:tests?|__tests__)[\/].+|(?:^|[\/])test_[^\/]+)\.py$/;
const PYTEST_NODE_ID = /^(?<file>[^:]+\.py)(?:::[A-Za-z_]\w*(?:\[[A-Za-z0-9_.-]+\])?)*$/u;
const UNITTEST_DOTTED_TARGET = /^(?:tests?|test)(?:\.[A-Za-z_]\w*)+$/u;
const DISCOVER_PATTERNS = Object.freeze(['test_*.py', '*_test.py']);
const ALLOWED_PYTEST_FLAGS = Object.freeze(['-q', '--quiet', '-v', '--verbose', '-x', '--exitfirst', '-s', '--capture=no', '--tb=short', '--tb=long', '--tb=auto', '--disable-warnings']);
const ALLOWED_UNITTEST_FLAGS = Object.freeze(['-v', '--verbose', '-q', '--quiet', '-f', '--failfast', '-b', '--buffer']);
const ALLOWED_PROJECT_TEST_SCRIPTS = Object.freeze([
  'frontend/apps/alipay-miniapp/scripts/test-category-builder-runtime.js',
]);

function repoRelativePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value)) {
    throw new Error(`${label} must be a scoped relative path`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').includes('..') || normalized.startsWith('./') || normalized === '.codegraph' || normalized.startsWith('.codegraph/')) {
    throw new Error(`${label} must be a scoped relative path`);
  }
  return normalized;
}

function nodeTestArgv(argv) {
  const [, subcommand, ...args] = argv;
  if (argv.length === 2 && ALLOWED_PROJECT_TEST_SCRIPTS.includes(repoRelativePath(subcommand, 'test script'))) {
    return ['node', repoRelativePath(subcommand, 'test script')];
  }
  if (subcommand === '--test' && args.length > 0 && args.every((arg) => NODE_TEST_PATH.test(repoRelativePath(arg, 'test path')))) {
    return ['node', '--test', ...args.map((arg) => repoRelativePath(arg, 'test path'))];
  }
  throw new Error('test command is not allowed');
}

function pythonTestFile(value) {
  const scoped = repoRelativePath(value, 'test path');
  if (!PYTHON_TEST_FILE.test(scoped)) throw new Error('test path must be a scoped test file');
  return scoped;
}

function pytestTarget(value) {
  const match = PYTEST_NODE_ID.exec(value);
  if (!match?.groups?.file) throw new Error('test target must be a scoped pytest target');
  const file = pythonTestFile(match.groups.file);
  return `${file}${value.slice(match.groups.file.length)}`;
}

function splitSafeFlags(args, allowedFlags) {
  const flags = [];
  const targets = [];
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.trim() === '') throw new Error('test command is not allowed');
    if (allowedFlags.includes(arg)) flags.push(arg);
    else targets.push(arg);
  }
  return { flags, targets };
}

function pytestArgv(argv) {
  const [python, dashM, moduleName, ...args] = argv;
  if (dashM !== '-m' || moduleName !== 'pytest') throw new Error('test command is not allowed');
  const { flags, targets } = splitSafeFlags(args, ALLOWED_PYTEST_FLAGS);
  if (targets.length === 0) throw new Error('test target is required');
  return [python, '-m', 'pytest', ...targets.map(pytestTarget), ...flags];
}

function unittestDiscoverArgv(python, args) {
  if (args[0] !== 'discover') return null;
  const flags = [];
  let start = null;
  let pattern = null;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (ALLOWED_UNITTEST_FLAGS.includes(arg)) {
      flags.push(arg);
    } else if (arg === '-s' || arg === '--start-directory') {
      start = repoRelativePath(args[index + 1], 'test path');
      index += 1;
    } else if (arg === '-p' || arg === '--pattern') {
      pattern = args[index + 1];
      index += 1;
    } else {
      throw new Error('test command is not allowed');
    }
  }
  if (!start || !/^(?:tests?|__tests__)(?:\/[^.][^/]*)*$/u.test(start)) throw new Error('test target must be scoped');
  if (!pattern || !DISCOVER_PATTERNS.includes(pattern)) throw new Error('test target must be scoped');
  return [python, '-m', 'unittest', 'discover', '-s', start, '-p', pattern, ...flags];
}

function unittestTarget(value) {
  if (value.endsWith('.py')) return pythonTestFile(value);
  if (UNITTEST_DOTTED_TARGET.test(value)) return value;
  throw new Error('test target must be scoped');
}

function unittestArgv(argv) {
  const [python, dashM, moduleName, ...args] = argv;
  if (dashM !== '-m' || moduleName !== 'unittest') throw new Error('test command is not allowed');
  const discover = unittestDiscoverArgv(python, args);
  if (discover) return discover;
  const { flags, targets } = splitSafeFlags(args, ALLOWED_UNITTEST_FLAGS);
  if (targets.length === 0) throw new Error('test target is required');
  return [python, '-m', 'unittest', ...targets.map(unittestTarget), ...flags];
}

export function normalizeTestCommandArgv(argv) {
  if (!Array.isArray(argv) || argv.length < 2) throw new Error('test command is not allowed');
  if (argv[0] === 'node') return nodeTestArgv(argv);
  if (argv[0] === 'python' || argv[0] === 'py') {
    if (argv[2] === 'pytest') return pytestArgv(argv);
    if (argv[2] === 'unittest') return unittestArgv(argv);
  }
  throw new Error('test command is not allowed');
}

export function parseValidatedTestPlan(commands) {
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('test plan is empty');
  return commands.map((command) => {
    if (!Array.isArray(command)) throw new Error('test plan must contain argv arrays; command strings are not allowed');
    return normalizeTestCommandArgv(command);
  });
}

export function testFilesFromValidatedCommands(commands) {
  return parseValidatedTestPlan(commands)
    .flatMap((argv) => argv.filter((arg) => NODE_TEST_PATH.test(arg) || PYTHON_TEST_FILE.test(arg) || PYTEST_NODE_ID.test(arg)))
    .map((arg) => arg.split('::')[0]);
}
