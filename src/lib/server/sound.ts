import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project } from '$lib/domain/schemas';
import { cutLength, cutsOf } from '$lib/domain/cuts';
import { autoGain, defaultSoundPlan, duckRegions, layLevels, mixPlan, rmsDb, type MixEntry, type MixInput } from '$lib/domain/sound';
import { programElapsed } from '$lib/media/speed-curve';
import { PCM_RATE, readPcm } from '$lib/server/audio-envelope';
import { probeMedia } from '$lib/server/media-probe';

type Failure = { ok: false; status: number; message: string };
const failure = (status: number, message: string): Failure => ({ ok: false, status, message });
const HZ = 100;

/**
 * Build the mix of a locked cut version (V1S-128): measure each layer, set
 * auto levels, find where music ducks, render with ffmpeg, and note the mix
 * on the version's sound plan.
 */
export async function buildMix(
	deps: { gateway: ProjectCommandGateway; store: ProjectStore; projectRoot: string },
	projectId: string, cutId: string, version: number
): Promise<{ ok: true; project: Project } | Failure> {
	const prepared = await prepareMix(deps, projectId, cutId, version);
	if (!prepared.ok) return prepared;
	const { project, plan, files, prefix, mix, report } = prepared;
	const folder = join(files, 'sound');
	await mkdir(folder, { recursive: true });
	const name = `${cutId.slice(-8)}-v${version}-mix.m4a`;
	const { args, report: planReport } = mixPlan({ ...mix, output: join(folder, name) });
	try {
		await runFfmpeg(args);
	} catch (cause) {
		return failure(500, `The mix render failed: ${cause instanceof Error ? cause.message : 'ffmpeg error'}`);
	}
	const saved = await deps.gateway.setSoundPlan({
		command: 'set_sound_plan', project_id: projectId, expected_version: project.version, cut_id: cutId, version,
		plan: { ...plan, mix: { url: `${prefix}sound/${encodeURIComponent(name)}`, built_at: new Date().toISOString(), report: [...report, ...planReport] } }
	});
	return saved.ok ? { ok: true, project: saved.data } : failure(409, saved.error.message);
}

/** ffmpeg with a render plan's arguments; rejects with its last lines of error output. */
export function runFfmpeg(args: string[], timeoutMs = 300_000): Promise<void> {
	return new Promise<void>((done, fail) => execFile('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, _out, stderr) => (error ? fail(new Error((stderr || error.message).trim().split('\n').slice(-3).join(' '))) : done())));
}

/**
 * Everything a mix render needs for a locked version, measured from the
 * audio: placed take segments, levels, duck regions, the other layers.
 * Shared by the mix and the export (stems).
 */
export async function prepareMix(
	deps: { store: ProjectStore; projectRoot: string },
	projectId: string, cutId: string, version: number
) {
	const project = await deps.store.readProject(projectId);
	if (!project) return failure(404, 'Project not found');
	const cut = cutsOf(project.production).find((entry) => entry.cut_id === cutId);
	const locked = cut?.versions?.find((v) => v.version === version);
	if (!cut || !locked) return failure(400, 'Lay sound against a locked cut version');
	const plan = locked.sound ?? defaultSoundPlan();
	const files = resolve(join(deps.projectRoot, projectId, 'files'));
	const prefix = `/api/projects/${projectId}/files/`;
	const local = (url: string) => {
		if (!url.startsWith(prefix)) return null;
		const file = resolve(join(files, decodeURIComponent(url.slice(prefix.length))));
		return file.startsWith(files + sep) ? file : null;
	};
	const length = cutLength({ entries: locked.entries });
	const report: string[] = [];

	// Take audio: where each entry sits, its level, its edges, and the activity that ducks the music.
	const entries: MixEntry[] = [];
	const activity = new Array<number>(Math.ceil(length * HZ)).fill(-120);
	const takeLevels: number[] = [];
	let at = 0;
	for (const entry of locked.entries) {
		const take = project.production.assets.find((asset) => asset.asset_id === entry.asset_id);
		const file = take ? local(take.url) : null;
		const pcm = file ? await readPcm(file).catch(() => null) : null;
		const duration = take?.duration_s ?? (file ? (await probeMedia(file)).duration_s : undefined) ?? entry.out_s;
		const placed = { in_s: entry.in_s, out_s: entry.out_s, speed: entry.speed, at_s: at };
		if (pcm) {
			layLevels(activity, HZ, pcm, PCM_RATE, placed);
			const level = rmsDb(pcm, PCM_RATE, entry.in_s, entry.out_s);
			if (level !== null && level > -70) takeLevels.push(level);
		}
		entries.push({
			file: pcm ? file : null, ...placed, before_s: entry.in_s, after_s: Math.max(0, duration - entry.out_s),
			edge_db: pcm ? rmsDb(pcm, PCM_RATE, entry.out_s - 0.03, entry.out_s) : null,
			average_db: pcm ? rmsDb(pcm, PCM_RATE, entry.in_s, entry.out_s) : null
		});
		at += programElapsed(entry.speed, entry.out_s - entry.in_s);
	}
	const takeLevel = takeLevels.length ? 10 * Math.log10(takeLevels.reduce((s, db) => s + Math.pow(10, db / 10), 0) / takeLevels.length) : null;

	// Music, ambience and effects.
	const musicFile = cut.music ? local(cut.music.url) : null;
	const musicPcm = musicFile ? await readPcm(musicFile).catch(() => null) : null;
	if (cut.music && !musicPcm) report.push('The song could not be read; music left out.');
	const ambienceFile = plan.ambience ? local(plan.ambience.url) : null;
	const ambiencePcm = ambienceFile ? await readPcm(ambienceFile).catch(() => null) : null;
	const effects: Array<{ file: string; at_s: number; from_s?: number; gain_db: number; length_s: number }> = [];
	for (const effect of plan.effects.filter((e) => !e.suggested)) {
		const file = local(effect.url);
		const pcm = file ? await readPcm(file).catch(() => null) : null;
		if (!file || !pcm) { report.push(`Effect ${effect.name} could not be read; left out.`); continue; }
		effects.push({ file, at_s: effect.at_s, from_s: effect.from_s, gain_db: autoGain(rmsDb(pcm, PCM_RATE), 'effects') + effect.gain_db, length_s: pcm.length / PCM_RATE - (effect.from_s ?? 0) });
	}

	// Duck the music where the take audio is clearly louder than its own average (hits, lines) and under effects.
	const threshold = Math.max((takeLevel ?? -30) + 8, -30);
	const duck = duckRegions(activity, HZ, threshold, effects);
	const auto = {
		take: autoGain(takeLevel, 'take'),
		music: musicPcm ? autoGain(rmsDb(musicPcm, PCM_RATE, 0, length), 'music') : 0,
		ambience: ambiencePcm ? autoGain(rmsDb(ambiencePcm, PCM_RATE), 'ambience') : 0,
		effects: 0
	};
	report.push(`Auto levels: take ${auto.take >= 0 ? '+' : ''}${auto.take} dB, music ${auto.music >= 0 ? '+' : ''}${auto.music} dB, ambience ${auto.ambience >= 0 ? '+' : ''}${auto.ambience} dB.`);

	const mix: Omit<MixInput, 'output'> = {
		length_s: length, entries, auto, plan, duck, effects,
		music: musicPcm && musicFile ? { file: musicFile } : null,
		ambience: ambiencePcm && ambienceFile ? { file: ambienceFile } : null
	};
	return { ok: true as const, project, cut, locked, plan, files, prefix, local, length, mix, report };
}
