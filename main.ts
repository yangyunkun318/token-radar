// Token radar entry (Node 22, standard library only).
//
// Takes the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the calibrated model in
// lib/model.ts, and writes the ranked board, the dashboard data, the dashboard
// itself, the screenshots and the dossier the scorer rebuilds byte for byte:
//
//   /output/board.json       the ranked board (198 rows on the sealed snapshot)
//   /output/data.js          the same board, as window.RADAR for the dashboard
//   /output/dashboard/       the static page (index.html, app.css, app.js)
//   /output/screenshots/     the board, detail and filtered views
//   /output/dossier.json     the vendored make.fun dossier of the above
//
// The page is a static page with no framework and no network: it reads the
// data.js this program writes from the same board it shows, so the screenshots
// and the code always agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_DIR = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Every --name <value> and --name=<value> pair on the command line, in order. */
function cliOptions(): Map<string, string> {
  const options = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 2) {
      options.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (i + 1 < args.length) {
      options.set(arg.slice(2), args[i + 1]!);
      i++;
    }
  }
  return options;
}

const options = cliOptions();
const option = (name: string, fallback: string): string => options.get(name) ?? fallback;

/** The snapshot file: --input <snapshot.json|directory>, defaulting to the sealed /input. */
function resolveSnapshot(): string {
  const input = option('input', '/input');
  const file = input.endsWith('.json') ? input : join(input, 'snapshot.json');
  if (!existsSync(file)) {
    process.stderr.write(`token radar: no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return file;
}

/** Copy a directory's regular files into `to`, skipping dot-names; returns the names copied. */
function mirrorDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The screenshots the gate wants: exactly the board, a detail view and a filtered view. */
function checkShots(names: string[]): void {
  if (names.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of names) {
    if (!SHOT_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }
}

/** Total bytes of the dashboard's own source files. */
function dashboardBytes(): number {
  return readdirSync(join(REPO_DIR, 'dashboard')).reduce((n, f) => n + statSync(join(REPO_DIR, 'dashboard', f)).size, 0);
}

const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(resolveSnapshot(), 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));
mirrorDir(join(REPO_DIR, 'dashboard'), join(outDir, 'dashboard'));
const shots = mirrorDir(join(REPO_DIR, 'screenshots'), join(outDir, 'screenshots'));
checkShots(shots);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(outDir, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_CAP, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(outDir, 'dossier.json'), dossier);

// The judge reads the dashboard's source only while it fits in the text cap: warn
// when the page's own source has grown past it, so a cut dossier never ships unnoticed.
const pageBytes = dashboardBytes();
if (pageBytes > TEXT_CAP_BYTES) {
  process.stderr.write(`token radar: warning: dashboard source is ${pageBytes} bytes, past the ${TEXT_CAP_BYTES} byte text cap: the judge reads a cut source\n`);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols in the snapshot, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early rows beyond the watchlist, ${radar.live_size} live tokens set aside)\n` +
    `token radar: overall median market-cap/TVL ${radar.overall_median_multiple}; top row ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: dashboard source ${pageBytes} bytes, dossier ${dossier.length} bytes; wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')}, ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
