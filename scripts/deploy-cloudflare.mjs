import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const sourceConfig = join(root, 'wrangler.toml');
const deployConfig = join(root, 'worker', '.tmp', 'wrangler-deploy.toml');
const deploySecretsFile = join(root, 'worker', '.tmp', 'wrangler-secrets.json');
const requiredSecrets = ['JWT_SECRET'];
const deployArgs = process.argv.slice(2);
const isDryRun = deployArgs.includes('--dry-run');
const keepsExistingVars = deployArgs.includes('--keep-vars');
const skipMigrations = deployArgs.includes('--skip-migrations');
const wranglerDeployArgs = deployArgs.filter(arg => arg !== '--skip-migrations');
const deployCommand = process.env.CF_MONITOR_DEPLOY_COMMAND === 'versions-upload'
  ? ['versions', 'upload']
  : ['deploy'];

function runWrangler(args, options = {}) {
  return spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function runD1Migrations() {
  if (skipMigrations) {
    console.log('Skipping D1 migrations (--skip-migrations).');
    return true;
  }
  console.log('Applying D1 migrations to cf-vps-monitor-db...');
  const result = runWrangler(['d1', 'migrations', 'apply', 'cf-vps-monitor-db'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('D1 migrations failed. Aborting deploy.');
    return false;
  }
  return true;
}

function currentGitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function writeDeployConfig() {
  const source = readFileSync(sourceConfig, 'utf8');
  const commit = currentGitCommit();
  let generated = /\nCURRENT_GIT_COMMIT\s*=/.test(source)
    ? source.replace(/CURRENT_GIT_COMMIT\s*=\s*"[^"]*"/, `CURRENT_GIT_COMMIT = "${commit}"`)
    : source.replace(/(\[vars\]\s*)/, `$1\nCURRENT_GIT_COMMIT = "${commit}"\n`);
  generated = generated
    .replace('main = "worker/src/index.ts"', 'main = "../src/index.ts"')
    .replace('directory = "frontend/dist"', 'directory = "../../frontend/dist"');
  mkdirSync(dirname(deployConfig), { recursive: true });
  writeFileSync(deployConfig, generated);
}

function writeDeploySecretsFile() {
  const secrets = Object.fromEntries(
    requiredSecrets
      .map(name => [name, process.env[name]?.trim() || ''])
      .filter(([, value]) => value),
  );
  if (Object.keys(secrets).length === 0) return false;

  const missing = requiredSecrets.filter(name => !secrets[name]);
  if (missing.length) {
    fail(`Missing required Worker secrets in build environment: ${missing.join(', ')}`);
  }

  mkdirSync(dirname(deploySecretsFile), { recursive: true });
  writeFileSync(deploySecretsFile, JSON.stringify(secrets), { mode: 0o600 });
  return true;
}

function checkSecrets() {
  const result = runWrangler(['secret', 'list', '--config', deployConfig]);
  if (result.status !== 0) {
    fail(`Could not list Worker secrets. Set them first with: npx wrangler secret put JWT_SECRET\n${result.stderr || result.stdout}`);
  }

  let secrets;
  try {
    secrets = JSON.parse(result.stdout);
  } catch {
    fail(`Could not parse Worker secret list.\n${result.stdout}`);
  }

  const names = new Set(secrets.map(secret => secret.name));
  const missing = requiredSecrets.filter(name => !names.has(name));
  if (missing.length) {
    fail(`Missing required Worker secrets: ${missing.join(', ')}\nSet them with: npx wrangler secret put <NAME>`);
  }
}

function buildWranglerDeployArgs() {
  const args = [...deployCommand, '--config', deployConfig, ...wranglerDeployArgs];
  if (hasDeploySecretsFile) args.push('--secrets-file', deploySecretsFile);
  return args;
}

writeDeployConfig();
const hasDeploySecretsFile = writeDeploySecretsFile();

if (isDryRun) {
  const args = buildWranglerDeployArgs();
  const deploy = runWrangler(args, { stdio: 'inherit' });
  if (hasDeploySecretsFile) rmSync(deploySecretsFile, { force: true });
  process.exit(deploy.status ?? 1);
}

if (!keepsExistingVars && !hasDeploySecretsFile) {
  checkSecrets();
}

if (!runD1Migrations()) {
  if (hasDeploySecretsFile) rmSync(deploySecretsFile, { force: true });
  process.exit(1);
}

console.log('Deploying Worker with D1 database...');

const args = buildWranglerDeployArgs();
const deploy = runWrangler(args, { stdio: 'inherit' });
if (hasDeploySecretsFile) rmSync(deploySecretsFile, { force: true });
if (deploy.status !== 0) process.exit(deploy.status ?? 1);
