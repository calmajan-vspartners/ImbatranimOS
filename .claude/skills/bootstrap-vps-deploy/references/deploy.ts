#!/usr/bin/env node
/**
 * Zero-dependency deploy tool — native Node TypeScript (no tsx, no compile).
 *
 * Run with Node 22.6+ (built-in type stripping):
 *
 *   node deploy/deploy.ts pre-deploy   # provision the server (Caddy + dirs)
 *   node deploy/deploy.ts deploy       # build the client locally + upload dist/
 *   node deploy/deploy.ts server       # rsync + npm ci + pm2 (re)start the service
 *   node deploy/deploy.ts all          # pre-deploy → deploy → server
 *
 * Flags:
 *   --no-build   (deploy)  upload the existing dist/ without rebuilding
 *   --skip-tests (deploy)  build without running typecheck + tests first
 *   --dry-run               print actions without touching the server
 *
 * Config comes from deploy/.env (copy deploy/.env.example). No secrets are
 * hard-coded; SSH auth uses your key / ~/.ssh/config exactly like plain ssh.
 *
 * ── ADAPT FOR YOUR REPO (search "TODO:") ──────────────────────────────────────
 *   • DIST_DIR        where your build emits (root dist/ or packages/<x>/dist/).
 *   • BUILD_BASE_ENV  the env var your framework reads for its sub-path `base`.
 *   • buildClient()   the build command(s).
 *   • verifyBuild()   the entry HTML + runtime artifacts to assert before upload.
 *   • serverIncludes  (server leg) the source paths the box needs to `npm ci`.
 *   • If there is no Node service, delete deployServer() + the "server"/"all"
 *     branches and the SERVER_* config.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// TODO: the env var your build reads for the sub-path base (e.g. Vite reads it
// into `base`, Astro into `base`). Keep it in sync with your build config.
const BUILD_BASE_ENV = "APP_BASE";

// --- Paths ------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ENV_FILE = join(HERE, ".env");
const CADDYFILE = join(HERE, "Caddyfile");
// TODO: where your client build emits. Monorepo example:
//   join(REPO_ROOT, "packages", "<app>", "dist")
const DIST_DIR = join(REPO_ROOT, "dist");

// --- Tiny terminal helpers --------------------------------------------------
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const step = (m: string) => console.log(`${c.cyan}▸${c.reset} ${m}`);
const ok = (m: string) => console.log(`${c.green}✓${c.reset} ${m}`);
const warn = (m: string) => console.log(`${c.yellow}!${c.reset} ${m}`);
const info = (m: string) => console.log(`  ${c.dim}${m}${c.reset}`);
function die(m: string): never {
  console.error(`${c.red}✗ ${m}${c.reset}`);
  process.exit(1);
}

// --- Minimal .env parser (no dotenv dependency) -----------------------------
type Env = Record<string, string>;
function loadEnv(path: string): Env {
  if (!existsSync(path)) {
    die(
      `Missing ${path}\n  Copy deploy/.env.example → deploy/.env and fill it in.`,
    );
  }
  const env: Env = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) die(`Missing required key "${key}" in deploy/.env`);
  return v;
}

// --- Config -----------------------------------------------------------------
interface Config {
  sshHost: string;
  sshArgs: string[];
  sshTarget: string;
  basePath: string; // normalized with leading + trailing slash, e.g. /myapp/
  remoteDir: string;
  publicUrl: string;
  remoteCaddyfile: string; // main Caddyfile (validated on reload, never overwritten)
  remoteCaddySnippet: string; // per-project snippet this tool writes
  sudoNoPasswd: boolean;
  // --- service leg ---
  serverDir: string;
  pm2Name: string;
  serverPort: string;
}

function buildConfig(env: Env): Config {
  const sshHost = env.SSH_HOST || "vps";
  const sshArgs: string[] = [];

  const user = env.SSH_USER;
  const hostname = env.SSH_HOSTNAME;
  const sshTarget = user && hostname ? `${user}@${hostname}` : sshHost;

  if (env.SSH_PORT) sshArgs.push("-p", env.SSH_PORT);
  if (env.SSH_KEY) sshArgs.push("-i", expandHome(env.SSH_KEY));

  return {
    sshHost,
    sshArgs,
    sshTarget,
    basePath: normalizeBase(env.BASE_PATH || "/myapp/"),
    remoteDir: required(env, "REMOTE_DIR"),
    publicUrl: env.PUBLIC_URL || "",
    remoteCaddyfile: env.REMOTE_CADDYFILE || "/etc/caddy/Caddyfile",
    remoteCaddySnippet:
      env.REMOTE_CADDY_SNIPPET || "/etc/caddy/sites/myapp.caddy",
    sudoNoPasswd: (env.SUDO_NOPASSWD || "false").toLowerCase() === "true",
    serverDir: env.SERVER_DIR || "/srv/myapp",
    pm2Name: env.PM2_NAME || "myapp",
    serverPort: env.SERVER_PORT || "8787",
  };
}

function normalizeBase(p: string): string {
  let b = p.trim();
  if (!b.startsWith("/")) b = `/${b}`;
  if (!b.endsWith("/")) b = `${b}/`;
  return b;
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(process.env.HOME || "", p.slice(1)) : p;
}

// --- Command runner ---------------------------------------------------------
let DRY_RUN = false;

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    allowFail?: boolean;
    quiet?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): { code: number; stdout: string } {
  const pretty = `${cmd} ${args.join(" ")}`;
  if (DRY_RUN) {
    info(`[dry-run] ${pretty}`);
    return { code: 0, stdout: "" };
  }
  if (!opts.quiet) info(pretty);
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: opts.quiet ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: opts.env ?? process.env,
  });
  if (res.error) {
    if (opts.allowFail) return { code: 1, stdout: "" };
    die(`Failed to run: ${pretty}\n  ${res.error.message}`);
  }
  const code = res.status ?? 1;
  if (code !== 0 && !opts.allowFail) {
    die(`Command exited ${code}: ${pretty}`);
  }
  return { code, stdout: (res.stdout as string) || "" };
}

function ssh(
  cfg: Config,
  remoteCmd: string,
  opts: { allowFail?: boolean; quiet?: boolean } = {},
) {
  return run("ssh", [...cfg.sshArgs, cfg.sshTarget, remoteCmd], opts);
}

function sshTest(cfg: Config, remoteCmd: string): boolean {
  if (DRY_RUN) {
    info(`[dry-run] ssh test: ${remoteCmd}`);
    return true;
  }
  const res = spawnSync("ssh", [...cfg.sshArgs, cfg.sshTarget, remoteCmd], {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
  });
  return (res.status ?? 1) === 0;
}

// =============================================================================
// PRE-DEPLOY PHASE — provision the server
// =============================================================================
function preDeploy(cfg: Config) {
  console.log(`\n${c.bold}=== Pre-deploy: provision server ===${c.reset}\n`);

  step("Checking SSH connectivity ...");
  if (!sshTest(cfg, "true")) {
    die(
      `Cannot reach ${cfg.sshTarget} over SSH.\n  Check SSH_HOST/SSH_KEY in deploy/.env and your ~/.ssh/config.`,
    );
  }
  ok(`Reachable: ${cfg.sshTarget}`);

  step("Ensuring Caddy is installed ...");
  if (sshTest(cfg, "command -v caddy >/dev/null 2>&1")) {
    ok("Caddy already installed.");
  } else {
    die(
      "Caddy not found on the server. Install it first " +
        "(https://caddyserver.com/docs/install), then re-run pre-deploy.",
    );
  }

  // Served directory exists and is writable by the ssh user (so rsync needs
  // no sudo on every deploy).
  step(`Ensuring remote dir ${cfg.remoteDir} exists ...`);
  if (sshTest(cfg, `test -w "$(dirname ${shq(cfg.remoteDir)})"`)) {
    ssh(cfg, `mkdir -p ${shq(cfg.remoteDir)}`);
  } else {
    sudoRemote(
      cfg,
      `mkdir -p ${shq(cfg.remoteDir)} && chown -R "$(whoami)" ${shq(cfg.remoteDir)}`,
      `create ${cfg.remoteDir} and hand it to your user`,
    );
  }
  ok(`Remote dir ready: ${cfg.remoteDir}`);

  step("Updating Caddy configuration ...");
  syncCaddyfile(cfg);

  console.log(`\n${c.green}✓ Pre-deploy complete.${c.reset}\n`);
}

function syncCaddyfile(cfg: Config) {
  if (!existsSync(CADDYFILE)) {
    die(`Missing ${CADDYFILE} — cannot configure Caddy.`);
  }
  // Upload the per-project snippet to a temp path the ssh user can write, then
  // move it into the snippets dir, validate the MAIN Caddyfile (which imports
  // the snippet), and reload. We never overwrite the main Caddyfile, so other
  // projects on the shared VPS are untouched.
  const tmp = "/tmp/deploy-snippet.caddy";
  run("scp", [...sshArgsForScp(cfg), CADDYFILE, `${cfg.sshTarget}:${tmp}`]);

  const apply = [
    `mkdir -p "$(dirname ${shq(cfg.remoteCaddySnippet)})"`,
    `cp ${tmp} ${shq(cfg.remoteCaddySnippet)}`,
    `rm -f ${tmp}`,
    `caddy validate --config ${shq(cfg.remoteCaddyfile)}`,
    "systemctl reload caddy",
  ].join(" && ");
  sudoRemote(
    cfg,
    apply,
    `install snippet → ${cfg.remoteCaddySnippet}, validate ${cfg.remoteCaddyfile}, reload Caddy`,
  );
  info(
    `Reminder: your main Caddyfile must \`import\` the snippets dir, e.g. ` +
      `import ${cfg.remoteCaddySnippet.replace(/\/[^/]+$/, "/*.caddy")}`,
  );
  ok("Caddy snippet installed and Caddy reloaded.");
}

// Run a command on the server with sudo. If passwordless sudo isn't available,
// print the exact command for the user to run by hand rather than hanging on a
// password prompt over a non-interactive channel.
function sudoRemote(cfg: Config, remoteCmd: string, label: string) {
  if (cfg.sudoNoPasswd) {
    ssh(cfg, `sudo sh -c ${shq(remoteCmd)}`);
    return;
  }
  warn(`Needs sudo on the server to: ${label}`);
  info("SUDO_NOPASSWD is false, so run this on the server yourself:");
  console.log(
    `\n  ${c.bold}ssh ${cfg.sshTarget}${c.reset} '${c.dim}sudo sh -c "${remoteCmd.replace(/"/g, '\\"')}"${c.reset}'\n`,
  );
  if (!DRY_RUN) {
    const ans = promptYesNo("Have you run it (or is it already done)? [y/N] ");
    if (!ans) die("Aborted — re-run pre-deploy after provisioning.");
  }
}

// =============================================================================
// DEPLOY PHASE — build the client locally, upload dist/
// =============================================================================
function deploy(cfg: Config, opts: { build: boolean; skipTests: boolean }) {
  console.log(`\n${c.bold}=== Deploy: build + upload ===${c.reset}\n`);

  if (opts.build) {
    if (opts.skipTests) {
      warn("Skipping typecheck + tests (--skip-tests).");
    } else {
      step("Typecheck ...");
      run("npm", ["run", "typecheck"]);
      step("Tests ...");
      run("npm", ["run", "test"]);
      ok("Typecheck + tests green.");
    }

    step(`Building client (${BUILD_BASE_ENV}=${cfg.basePath}) ...`);
    buildClient(cfg);
    if (DRY_RUN) {
      info("dry-run: skipping dist/ verification (no real build ran).");
    } else {
      verifyBuild(cfg);
      ok("Build complete and verified.");
    }
  } else {
    warn("Skipping build (--no-build); uploading existing dist/.");
    if (!existsSync(DIST_DIR))
      die("dist/ not found — run without --no-build first.");
  }

  // deploy only builds + uploads; provisioning lives in pre-deploy. If the dir
  // is missing, the server was never set up — bail rather than rsync --delete
  // into a fresh/wrong dir (a mistyped REMOTE_DIR would mirror into a stray dir).
  step("Checking remote dir exists ...");
  if (!sshTest(cfg, `test -d ${shq(cfg.remoteDir)}`)) {
    die(
      `Remote dir ${cfg.remoteDir} does not exist on ${cfg.sshTarget}.\n` +
        `  Run \`npm run deploy:pre\` first to provision the server.`,
    );
  }

  step(`Syncing dist/ → ${cfg.sshTarget}:${cfg.remoteDir} ...`);
  // Trailing slash on dist/ uploads the CONTENTS. --delete keeps the remote an
  // exact mirror (drops stale hashed assets). -z compresses over the wire.
  const rsyncArgs = [
    "-avz",
    "--delete",
    ...rsyncSshOpt(cfg),
    `${DIST_DIR}/`,
    `${cfg.sshTarget}:${cfg.remoteDir}/`,
  ];
  run("rsync", rsyncArgs);

  ok("Deployed.");
  info(`Live at ${liveUrl(cfg)}`);
  console.log(`\n${c.green}✓ Deploy complete.${c.reset}\n`);
}

// TODO: your build command(s). Inject the sub-path base for THIS build only so
// the framework bakes it into every emitted asset URL.
function buildClient(cfg: Config) {
  run("npm", ["run", "build"], {
    env: { ...process.env, [BUILD_BASE_ENV]: cfg.basePath },
  });
}

// =============================================================================
// SERVER PHASE — deploy a long-lived Node service + (re)start it on pm2
// =============================================================================
// Delete this whole phase (and its CLI branches + SERVER_* config) if the
// project has no Node service.
function deployServer(cfg: Config) {
  console.log(`\n${c.bold}=== Server: deploy + pm2 (re)start ===${c.reset}\n`);

  step("Checking SSH + pm2 + node on the server ...");
  if (!sshTest(cfg, "true")) die(`Cannot reach ${cfg.sshTarget} over SSH.`);
  if (!sshTest(cfg, "command -v pm2 >/dev/null 2>&1")) {
    die(
      "pm2 not found on the server. Install it (`npm i -g pm2`) then re-run, " +
        "or run pre-deploy first.",
    );
  }
  if (!sshTest(cfg, "command -v node >/dev/null 2>&1")) {
    die("node not found on the server.");
  }
  ok("Server has node + pm2.");

  step(`Ensuring ${cfg.serverDir} exists ...`);
  if (sshTest(cfg, `test -w "$(dirname ${shq(cfg.serverDir)})"`)) {
    ssh(cfg, `mkdir -p ${shq(cfg.serverDir)}`);
  } else {
    sudoRemote(
      cfg,
      `mkdir -p ${shq(cfg.serverDir)} && chown -R "$(whoami)" ${shq(cfg.serverDir)}`,
      `create ${cfg.serverDir} and hand it to your user`,
    );
  }

  // Rsync the SOURCE (not node_modules) so the box can `npm ci`. In a monorepo,
  // `npm ci` validates the lockfile against the FULL workspace set declared in
  // package.json, so send all workspace dirs (a partial tree makes it bail).
  // node_modules is excluded (heavy, rebuilt on the box); keep any committed
  // runtime artifacts the service reads (e.g. a compiled wasm under dist/).
  // TODO: adapt serverIncludes to your repo's workspace layout.
  step(`Syncing source → ${cfg.sshTarget}:${cfg.serverDir} ...`);
  const serverIncludes = [
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "packages",
    "tools",
  ];
  const rsyncArgs = [
    "-avzR", // -R: preserve relative path names so layout is kept
    "--delete",
    "--exclude=node_modules",
    "--exclude=*.map",
    ...rsyncSshOpt(cfg),
    ...serverIncludes,
    `${cfg.sshTarget}:${cfg.serverDir}/`,
  ];
  run("rsync", rsyncArgs, { cwd: REPO_ROOT });

  step("Installing deps on the box (npm ci) ...");
  // Full `npm ci` (not --omit=dev): the runtime (e.g. tsx) is often a devDep,
  // and the workspace install wires the @scope/* symlinks.
  ssh(cfg, `cd ${shq(cfg.serverDir)} && npm ci`);

  step(
    `Starting/reloading pm2 process "${cfg.pm2Name}" (PORT=${cfg.serverPort}) ...`,
  );
  // `pm2 reload` if it already exists, else `pm2 start`. We start the root
  // `npm run server` script so pm2 supervises it. --update-env picks up PORT.
  const pm2Cmd =
    `cd ${shq(cfg.serverDir)} && ` +
    `PORT=${cfg.serverPort} pm2 describe ${shq(cfg.pm2Name)} >/dev/null 2>&1 ` +
    `&& PORT=${cfg.serverPort} pm2 reload ${shq(cfg.pm2Name)} --update-env ` +
    `|| PORT=${cfg.serverPort} pm2 start npm --name ${shq(cfg.pm2Name)} -- run server`;
  ssh(cfg, pm2Cmd);
  ssh(cfg, "pm2 save", { allowFail: true });

  ok(`Service deployed and running under pm2 as "${cfg.pm2Name}".`);
  console.log(`\n${c.green}✓ Server deploy complete.${c.reset}\n`);
}

// Sanity-check the emitted bundle before shipping: the entry HTML + runtime
// assets must exist, and the HTML must reference assets under the configured
// sub-path (else the app 404s its own scripts when served).
// TODO: adapt the artifact list to what your build emits + fetches at runtime.
function verifyBuild(cfg: Config) {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    die(`dist/index.html missing at ${DIST_DIR} — build did not emit.`);
  }
  for (const rel of [
    // e.g. "wasm/pathfinding.wasm", "atlas/index.json" — runtime-fetched assets
    // the framework can't rewrite. Leave empty if there are none.
  ]) {
    if (!existsSync(join(DIST_DIR, rel)))
      die(`expected artifact missing: dist/${rel}`);
  }
  const html = readFileSync(join(DIST_DIR, "index.html"), "utf8");
  const needle = `${cfg.basePath}assets/`;
  if (!html.includes(needle)) {
    die(
      `index.html does not reference "${needle}" — wrong build base. ` +
        `Check BASE_PATH in deploy/.env and rebuild.`,
    );
  }
}

// --- SSH option plumbing for scp / rsync ------------------------------------
function sshArgsForScp(cfg: Config): string[] {
  const args: string[] = [];
  const portIdx = cfg.sshArgs.indexOf("-p");
  if (portIdx !== -1) args.push("-P", cfg.sshArgs[portIdx + 1]);
  const keyIdx = cfg.sshArgs.indexOf("-i");
  if (keyIdx !== -1) args.push("-i", cfg.sshArgs[keyIdx + 1]);
  return args;
}

function rsyncSshOpt(cfg: Config): string[] {
  if (cfg.sshArgs.length === 0) return [];
  return ["-e", `ssh ${cfg.sshArgs.join(" ")}`];
}

// Build the success URL without doubling the sub-path: PUBLIC_URL may already
// include basePath, so only append it if it's not already the suffix.
function liveUrl(cfg: Config): string {
  if (!cfg.publicUrl) return `your site${cfg.basePath}`;
  const base = cfg.publicUrl.replace(/\/$/, "");
  const sub = cfg.basePath.replace(/\/$/, "");
  if (base.endsWith(sub)) return `${base}/`;
  return `${base}${cfg.basePath}`;
}

// --- shell quoting + tiny synchronous prompt --------------------------------
function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function promptYesNo(question: string): boolean {
  process.stdout.write(question);
  const buf = Buffer.alloc(64);
  let bytes = 0;
  try {
    bytes = readSync(0, buf, 0, buf.length, null);
  } catch {
    return false;
  }
  const ans = buf.toString("utf8", 0, bytes).trim().toLowerCase();
  return ans === "y" || ans === "yes";
}

// =============================================================================
// CLI
// =============================================================================
function main() {
  const argv = process.argv.slice(2);
  const phase = argv.find((a) => !a.startsWith("-")) || "all";
  DRY_RUN = argv.includes("--dry-run");
  const noBuild = argv.includes("--no-build");
  const skipTests = argv.includes("--skip-tests");

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const env = loadEnv(ENV_FILE);
  const cfg = buildConfig(env);

  if (DRY_RUN) warn("DRY RUN — no changes will be made.\n");

  switch (phase) {
    case "pre-deploy":
      preDeploy(cfg);
      break;
    case "deploy":
      deploy(cfg, { build: !noBuild, skipTests });
      break;
    case "server":
      deployServer(cfg);
      break;
    case "all":
      preDeploy(cfg);
      deploy(cfg, { build: !noBuild, skipTests });
      deployServer(cfg);
      break;
    default:
      die(
        `Unknown phase "${phase}". Use pre-deploy | deploy | server | all (--help).`,
      );
  }
}

function printHelp() {
  console.log(`
${c.bold}Deploy${c.reset} — zero-dependency Node TypeScript deploy tool.

${c.bold}Usage${c.reset}
  node deploy/deploy.ts <phase> [flags]

${c.bold}Phases${c.reset}
  pre-deploy   Provision: check SSH, ensure Caddy, ensure ${c.dim}REMOTE_DIR${c.reset},
               sync the Caddy snippet, reload Caddy.
  deploy       Typecheck + test + build the CLIENT locally with the sub-path
               base, then rsync dist/ to the server (exact mirror).
  server       Deploy the Node service: rsync source, npm ci on the box,
               pm2 start/reload ${c.dim}PM2_NAME${c.reset} on ${c.dim}SERVER_PORT${c.reset}.
  all          pre-deploy, then deploy, then server. (default)

${c.bold}Flags${c.reset}
  --no-build    Deploy the existing dist/ without rebuilding.
  --skip-tests  Build without running typecheck + tests first.
  --dry-run     Print every action without touching the server.
  -h, --help    This help.

${c.bold}Config${c.reset}
  Reads ${c.dim}deploy/.env${c.reset} (copy from deploy/.env.example). No secrets in code.
`);
}

main();
