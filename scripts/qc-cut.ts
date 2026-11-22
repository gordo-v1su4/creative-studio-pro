// QC report (V1S-505) on any rendered cut MP4, outside the app.
//
//   bun scripts/qc-cut.ts <cut.mp4>
//       picture ends, sound present and length only (no plan to compare against)
//   bun scripts/qc-cut.ts <cut.mp4> --project <id> --cut <id> --version <n> [--root <projects folder>] [--asr]
//       all five checks against that locked cut version (its entries, takes, song and dialogue);
//       --root defaults to CSP_PROJECT_ROOT. Reads the project only; nothing is saved to it.
//
// The contact sheet and qc.json go into <cut>-qc/ beside the MP4. Prints the notes and exits 1 on a fail.
import { dirname, join, basename, resolve } from 'node:path';
import { ProjectStore } from '../src/lib/adapters/project-store';
import { EXPORT_FPS } from '../src/lib/domain/export';
import { qcNotes } from '../src/lib/domain/qc';
import { runQc, type QcInput } from '../src/lib/server/qc';
import { qcInputFor } from '../src/lib/server/qc-cut';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!file) { console.error('usage: bun scripts/qc-cut.ts <cut.mp4> [--project <id> --cut <id> --version <n> [--root <dir>] [--asr]]'); process.exit(2); }

const mp4 = resolve(file);
const outDir = join(dirname(mp4), `${basename(mp4).replace(/\.[^.]+$/, '')}-qc`);
let base: Omit<QcInput, 'file' | 'outDir'> = { fps: EXPORT_FPS, entries: [], planned_s: null, crossfade_s: 0, music: null };
const projectId = flag('project'), cutId = flag('cut'), version = Number(flag('version'));
if (projectId && cutId && version) {
	const root = flag('root') ?? process.env.CSP_PROJECT_ROOT;
	if (!root) { console.error('--root or CSP_PROJECT_ROOT is needed with --project'); process.exit(2); }
	const input = await qcInputFor({ store: new ProjectStore({ root }), projectRoot: root }, projectId, cutId, version);
	if (!input.ok) { console.error(input.message); process.exit(2); }
	base = input.base;
}
const report = await runQc({ ...base, file: mp4, outDir, asr: args.includes('--asr') });
console.log(qcNotes(report, 200));
console.log(`\nContact sheet and qc.json: ${outDir}`);
process.exit(report.status === 'fail' ? 1 : 0);
