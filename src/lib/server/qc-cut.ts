import { join } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { CutVersion, Project, SoundPlan } from '$lib/domain/schemas';
import { EXPORT_FPS, frameGrid } from '$lib/domain/export';
import type { QcEntry, QcReport } from '$lib/domain/qc';
import { isSlateId } from '$lib/domain/slate';
import { programElapsed } from '$lib/media/speed-curve';
import { prepareMix } from '$lib/server/sound';
import { runQc, type QcInput } from '$lib/server/qc';

type Failure = { ok: false; status: number; message: string };

/**
 * The QC entries of a locked version: picture starts on the export frame grid (as the
 * export bakes them and the mix places their sound), the plan's unrounded starts (as the mix and the song see them),
 * each take's file and in-point, and the shot's written dialogue.
 */
export function qcEntries(project: Project, locked: Pick<CutVersion, 'entries'>, local: (url: string) => string | null): { entries: QcEntry[]; planned_s: number } {
	const grid = frameGrid(locked.entries);
	let planned = 0;
	const entries = locked.entries.map((entry, i) => {
		const card = project.production.cards.find((c) => c.card_id === entry.card_id);
		const take = isSlateId(entry.asset_id) ? undefined : project.production.assets.find((a) => a.asset_id === entry.asset_id);
		const played = programElapsed(entry.speed, entry.out_s - entry.in_s);
		const file = take && take.kind === 'video' ? local(take.url) : null;
		const dialogue = (card?.source?.dialogue ?? card?.fit?.dialogue ?? '').trim();
		const row: QcEntry = {
			title: card?.title ?? entry.card_id, at_s: grid[i].start / EXPORT_FPS, length_s: grid[i].frames / EXPORT_FPS, planned_at_s: planned,
			take: file ? { file, in_s: entry.in_s } : null, ramped: Boolean(entry.speed?.some((p) => p.rate !== 1)),
			...(dialogue ? { dialogue } : {})
		};
		planned += played;
		return row;
	});
	return { entries: entries.map((e, i) => ({ ...e, title: `${String(i + 1).padStart(2, '0')} ${e.title}` })), planned_s: grid.reduce((sum, g) => sum + g.frames, 0) / EXPORT_FPS };
}

/** Everything a QC run of this version needs except the file and where its output goes. */
export async function qcInputFor(
	deps: { store: ProjectStore; projectRoot: string }, projectId: string, cutId: string, version: number
): Promise<({ ok: true; project: Project; plan: SoundPlan; files: string; prefix: string; local: (url: string) => string | null; base: Omit<QcInput, 'file' | 'outDir'> }) | Failure> {
	const prepared = await prepareMix(deps, projectId, cutId, version);
	if (!prepared.ok) return prepared;
	const { project, cut, locked, plan, files, prefix, local } = prepared;
	const { entries, planned_s } = qcEntries(project, locked, local);
	const musicFile = cut.music && !plan.layers.music.mute ? local(cut.music.url) : null;
	return {
		ok: true, project, plan, files, prefix, local,
		base: { fps: EXPORT_FPS, entries, planned_s, crossfade_s: plan.crossfade_s, take_muted: plan.layers.take.mute, music: musicFile ? { file: musicFile, sections: cut.music!.sections } : null }
	};
}

/**
 * Run the QC report on a version's render and save it on the version's sound plan:
 * the export's MP4 by default, or any rendered cut that is a project file (an exact-mix
 * playback cut made outside Export). Output lands beside the export, or in files/qc/.
 */
export async function qcCut(
	deps: { gateway: ProjectCommandGateway; store: ProjectStore; projectRoot: string },
	projectId: string, cutId: string, version: number, options: { url?: string; asr?: boolean } = {}
): Promise<{ ok: true; project: Project; report: QcReport } | Failure> {
	const input = await qcInputFor(deps, projectId, cutId, version);
	if (!input.ok) return input;
	const { project, plan, files, prefix, local } = input;
	const url = options.url ?? plan.export?.mp4;
	if (!url) return { ok: false, status: 400, message: 'Export the cut first, or name a rendered cut to check' };
	const file = local(url);
	if (!file) return { ok: false, status: 400, message: 'The render is not a file in the project' };
	const fromExport = !options.url || options.url === plan.export?.mp4;
	const sub = fromExport && plan.export ? decodeURIComponent(plan.export.mp4.slice(prefix.length)).split('/').slice(0, -1).join('/') : `qc/${cutId.slice(-8)}-v${version}`;
	const report = await runQc({ ...input.base, file, label: url, outDir: join(files, sub), sheetUrl: `${prefix}${sub.split('/').map(encodeURIComponent).join('/')}/qc-sheet.jpg`, asr: options.asr });
	const saved = await deps.gateway.setSoundPlan({ command: 'set_sound_plan', project_id: projectId, expected_version: project.version, cut_id: cutId, version, plan: { ...plan, qc: report } });
	if (!saved.ok) return { ok: false, status: 409, message: saved.error.message };
	return { ok: true, project: saved.data, report };
}
