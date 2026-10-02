import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { Project } from '$lib/domain/schemas';
import { bakePlan, buildFcpxml, draftTakes, mp4Plan } from '$lib/domain/export';
import { mixPlan, type Layer } from '$lib/domain/sound';
import { safeFileName } from '$lib/domain/media';
import { prepareMix, runFfmpeg } from '$lib/server/sound';

type Failure = { ok: false; status: number; message: string };
const failure = (status: number, message: string): Failure => ({ ok: false, status, message });

/**
 * Export a locked, mixed cut version (V1S-130) into files/export/<cut>-v<n>/:
 * each entry baked to an intermediate (trim and ramp rendered in), the mix
 * and one stem per layer, the MP4, and the Resolve timeline (.fcpxml) that
 * references them. Notes the export, and any takes still at draft
 * resolution, on the version's sound plan.
 */
export async function exportCut(
	deps: { gateway: ProjectCommandGateway; store: ProjectStore; projectRoot: string },
	projectId: string, cutId: string, version: number
): Promise<{ ok: true; project: Project; folder: string } | Failure> {
	const prepared = await prepareMix(deps, projectId, cutId, version);
	if (!prepared.ok) return prepared;
	const { project, cut, locked, plan, files, prefix, local, mix } = prepared;
	const mixFile = plan.mix ? local(plan.mix.url) : null;
	if (!mixFile) return failure(400, 'Build the mix in the Sound tab first');

	const slug = `${safeFileName(cut.name).replace(/\.[^.]*$/, '')}-v${version}`;
	const folderName = `${cutId.slice(-8)}-v${version}`;
	const folder = join(files, 'export', folderName);
	await rm(folder, { recursive: true, force: true });
	await mkdir(folder, { recursive: true });
	const url = (name: string) => `${prefix}export/${folderName}/${encodeURIComponent(name)}`;
	const titles = locked.entries.map((entry) => project.production.cards.find((card) => card.card_id === entry.card_id)?.title ?? entry.card_id);

	try {
		// Intermediates: trims and ramps baked in, one export frame grid.
		const clips = [];
		for (const [i, entry] of locked.entries.entries()) {
			const take = project.production.assets.find((asset) => asset.asset_id === entry.asset_id);
			const source = take ? local(take.url) : null;
			if (!source) return failure(400, `${titles[i]}: its take isn't a file in the project`);
			const name = `${String(i + 1).padStart(2, '0')}-${safeFileName(titles[i]).replace(/\.[^.]*$/, '').slice(0, 60)}.mp4`;
			const bake = bakePlan({ file: source, in_s: entry.in_s, out_s: entry.out_s, speed: entry.speed, output: join(folder, name) });
			await runFfmpeg(bake.args);
			clips.push({ name: `${String(i + 1).padStart(2, '0')} ${titles[i]}`, file: join(folder, name), frames: bake.frames });
		}
		const total = clips.reduce((sum, clip) => sum + clip.frames, 0);

		// The mix, and one stem per layer that is on.
		await copyFile(mixFile, join(folder, 'mix.m4a'));
		const audio = [{ name: 'Mix', file: join(folder, 'mix.m4a'), frames: total }];
		const present: Record<Layer, boolean> = { take: mix.entries.some((e) => e.file), ambience: !!mix.ambience, music: !!mix.music, effects: mix.effects.length > 0 };
		for (const layer of ['take', 'ambience', 'music', 'effects'] as const) {
			if (!present[layer] || plan.layers[layer].mute) continue;
			const solo = { ...plan, layers: Object.fromEntries((['take', 'ambience', 'music', 'effects'] as const).map((l) => [l, { ...plan.layers[l], mute: l !== layer }])) as typeof plan.layers };
			const name = `stem-${layer}.m4a`;
			await runFfmpeg(mixPlan({ ...mix, plan: solo, output: join(folder, name) }).args);
			audio.push({ name: `${layer[0].toUpperCase()}${layer.slice(1)} stem`, file: join(folder, name), frames: total });
		}

		// The MP4 and the Resolve timeline.
		const mp4 = `${slug}.mp4`;
		await runFfmpeg(mp4Plan({ intermediates: clips.map((c) => c.file), mix: join(folder, 'mix.m4a'), output: join(folder, mp4) }), 600_000);
		const fcpxml = `${slug}.fcpxml`;
		await writeFile(join(folder, fcpxml), buildFcpxml({ title: `${cut.name} v${version}`, clips, audio }), 'utf8');

		const drafts = draftTakes(locked.entries.map((entry, i) => ({ title: titles[i], take: project.production.assets.find((asset) => asset.asset_id === entry.asset_id) })));
		const listed = [...clips.map((c) => ({ name: c.file.split(/[\\/]/).pop()! })), ...audio.map((a) => ({ name: a.file.split(/[\\/]/).pop()! }))];
		const saved = await deps.gateway.setSoundPlan({
			command: 'set_sound_plan', project_id: projectId, expected_version: project.version, cut_id: cutId, version,
			plan: { ...plan, export: { built_at: new Date().toISOString(), folder, mp4: url(mp4), fcpxml: url(fcpxml), files: listed.map((f) => ({ name: f.name, url: url(f.name) })), drafts } }
		});
		if (!saved.ok) return failure(409, saved.error.message);
		return { ok: true, project: saved.data, folder };
	} catch (cause) {
		return failure(500, `The export render failed: ${cause instanceof Error ? cause.message : 'ffmpeg error'}`);
	}
}
