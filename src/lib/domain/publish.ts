import { z } from 'zod';
import type { Project, ProductionAsset, StoryCard } from '$lib/domain/schemas';
import { pickFor } from '$lib/domain/takes';
import { liveSpine } from '$lib/domain/spine';
import { cutsOf, cutVersionEntries } from '$lib/domain/cuts';

/**
 * Publishing: the studio stays on the operator's machine; what visitors see is a snapshot of a project,
 * copied to public storage with only the media it uses. A snapshot is read-only data: the story, the
 * episode outline, the board (each beat with its picked take), and the cuts (with their exported film).
 * Agent prompts are left out unless the operator chooses to show them. Nothing in it can be edited.
 */

const media = z.object({
	/** Path inside the project's files folder, e.g. "seedance/P01-01.mp4" (the published copy keeps it). */
	file: z.string().min(1).max(1000),
	kind: z.enum(['image', 'video', 'audio']),
	mime: z.string().max(200)
});
export type PublicMedia = z.infer<typeof media>;

export const publicSnapshotSchema = z.object({
	schema_version: z.literal(1),
	slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
	project_id: z.string(),
	title: z.string().max(300),
	logline: z.string().max(2000),
	published_at: z.string(),
	show_prompts: z.boolean(),
	series: z.object({
		episode_number: z.number(), episode_title: z.string().max(300), summary: z.string().max(8000), twist: z.string().max(4000), cliffhanger: z.string().max(4000),
		scenes: z.array(z.object({ page_id: z.string(), title: z.string(), act: z.string(), summary: z.string(), location: z.string(), characters: z.array(z.string()), timecode: z.string(), group_id: z.string() }))
	}).nullable(),
	groups: z.array(z.object({ group_id: z.string(), name: z.string() })),
	beats: z.array(z.object({
		id: z.string(), title: z.string(), beat: z.string(), purpose: z.string(), duration_s: z.number(),
		group_id: z.string().nullable(),
		/** Position in the story order; null when the beat is off the spine or benched. */
		order: z.number().int().nullable(),
		take: media.nullable(),
		prompts: z.object({ image: z.string(), video: z.string() }).optional()
	})),
	cuts: z.array(z.object({
		id: z.string(), name: z.string(), version: z.number().int(), locked: z.boolean(), length_s: z.number(),
		/** The exported, mixed MP4 of this version, when there is one. */
		film: media.nullable(),
		entries: z.array(z.object({ beat_id: z.string(), media, in_s: z.number(), out_s: z.number() }))
	})),
	/** Every project file the snapshot points at: what publishing copies. */
	files: z.array(z.string())
});
export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;

export const publicIndexEntrySchema = z.object({ slug: z.string(), title: z.string(), logline: z.string(), published_at: z.string(), poster: z.string().nullable(), beats: z.number(), cuts: z.number(), episode: z.string().nullable() });
export type PublicIndexEntry = z.infer<typeof publicIndexEntrySchema>;

export const slugOf = (title: string) => title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'project';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' };

/** A project-files URL ("/api/projects/<id>/files/<path>") as a published media reference; anything else is left out. */
export function mediaOf(projectId: string, url: string | undefined, kind?: ProductionAsset['kind']): PublicMedia | null {
	if (!url) return null;
	const prefix = `/api/projects/${projectId}/files/`;
	if (!url.startsWith(prefix)) return null;
	const file = url.slice(prefix.length).split(/[?#]/)[0].split('/').map((part) => decodeURIComponent(part)).join('/');
	if (!file || file.split('/').some((part) => part === '..' || part === '')) return null;
	const ext = file.split('.').pop()!.toLowerCase();
	const mime = MIME[ext];
	if (!mime) return null;
	return { file, kind: kind ?? (mime.split('/')[0] as PublicMedia['kind']), mime };
}

export function buildSnapshot(project: Project, input: { slug?: string; show_prompts: boolean; now: string }): PublicSnapshot {
	const { production } = project;
	const id = project.project_id;
	const spine = liveSpine(production);
	const orderOf = new Map(spine.map((card, i) => [card.card_id, i]));
	const assetById = new Map(production.assets.map((asset) => [asset.asset_id, asset]));
	const files = new Set<string>();
	const use = (m: PublicMedia | null) => { if (m) files.add(m.file); return m; };

	const beatOf = (card: StoryCard) => {
		const pick = pickFor(production, card);
		return {
			id: card.card_id, title: card.title, beat: card.beat, purpose: card.purpose, duration_s: card.duration_ms / 1000,
			group_id: card.group_id ?? null, order: card.benched ? null : (orderOf.get(card.card_id) ?? null),
			take: use(pick ? mediaOf(id, pick.url, pick.kind) : null),
			...(input.show_prompts ? { prompts: { image: card.image_prompt, video: card.video_prompt } } : {})
		};
	};
	// Story order first, then the beats off the spine in board order.
	const ordered = [...spine, ...production.cards.filter((card) => !orderOf.has(card.card_id)).toSorted((a, b) => a.order - b.order)];

	const cuts = cutsOf(production).map((cut) => {
		const version = cut.locked ? cut.version : (cut.versions?.at(-1)?.version ?? cut.version);
		const locked = cut.versions?.find((v) => v.version === version);
		const entries = (locked ? cutVersionEntries(cut, version) : null) ?? cut.entries;
		return {
			id: cut.cut_id, name: cut.name, version, locked: Boolean(locked),
			length_s: Math.round(entries.reduce((sum, entry) => sum + (entry.out_s - entry.in_s), 0) * 100) / 100,
			film: use(mediaOf(id, locked?.sound?.export?.mp4, 'video')),
			entries: entries.flatMap((entry) => {
				const asset = assetById.get(entry.asset_id);
				const m = use(asset ? mediaOf(id, asset.url, asset.kind) : null);
				return m ? [{ beat_id: entry.card_id, media: m, in_s: entry.in_s, out_s: entry.out_s }] : [];
			})
		};
	});

	const series = project.series;
	return publicSnapshotSchema.parse({
		schema_version: 1, slug: input.slug ?? slugOf(project.title), project_id: id, title: project.title,
		logline: production.logline || project.seed.brief || '', published_at: input.now, show_prompts: input.show_prompts,
		series: series ? {
			episode_number: series.episode_number, episode_title: series.episode_title, summary: series.summary, twist: series.twist, cliffhanger: series.cliffhanger,
			scenes: series.scenes.map((s) => ({ page_id: s.page_id, title: s.title, act: s.act, summary: s.summary, location: s.location, characters: s.characters, timecode: s.timecode, group_id: s.group_id }))
		} : null,
		groups: (production.groups ?? []).map((group) => ({ group_id: group.group_id, name: group.name })),
		beats: ordered.map(beatOf),
		cuts,
		files: [...files].sort()
	});
}

/** The index card for a snapshot: the first picked still or video, counts, and the episode it is. */
export function indexEntryOf(snapshot: PublicSnapshot): PublicIndexEntry {
	const poster = snapshot.beats.find((beat) => beat.take?.kind === 'image')?.take?.file ?? null;
	return {
		slug: snapshot.slug, title: snapshot.title, logline: snapshot.logline, published_at: snapshot.published_at, poster,
		beats: snapshot.beats.length, cuts: snapshot.cuts.length,
		episode: snapshot.series ? `EP${String(snapshot.series.episode_number).padStart(2, '0')}` : null
	};
}
