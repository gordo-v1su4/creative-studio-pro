import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { buildSnapshot, indexEntryOf, mediaOf, slugOf } from '../../src/lib/domain/publish';
import type { ProductionState, StoryCard } from '../../src/lib/domain/schemas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const id = (n: number) => `01a0fda5-0000-7000-8000-${String(n).padStart(12, '0')}`;
const card = (n: number, title: string, extra: Partial<StoryCard> = {}): StoryCard => ({
	card_id: id(n), order: n, title, beat: `beat ${n}`, purpose: 'why', duration_ms: 5000, image_prompt: `image prompt ${n}`, video_prompt: `video prompt ${n}`, status: 'draft', ...extra
});

describe('publishing a snapshot', () => {
	test('story order, picked takes, a locked cut with its film, only the files used, prompts only when asked', async () => {
		const root = await mkdtemp(join(tmpdir(), 'csp-pub-')); roots.push(root);
		const gateway = new ProjectCommandGateway(new ProjectStore({ root }));
		const created = await gateway.createProject({ command: 'create_project', title: 'Blood Rush — Trailer', brief: 'A teaser.', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const p = created.data.project_id;
		const file = (path: string) => `/api/projects/${p}/files/${path}`;
		const asset = (n: number, cardN: number, kind: 'image' | 'video', path: string) => ({ asset_id: id(500 + n), card_id: id(cardN), kind, name: path, mime_type: kind === 'video' ? 'video/mp4' : 'image/jpeg', url: file(path), created_at: '2026-10-01T00:00:00.000Z' });
		const production: ProductionState = {
			status: 'draft', title: 'Blood Rush — Trailer', logline: 'Kai breaks the one rule.', premise: '', theme: '', updated_at: null,
			cards: [card(0, 'V6-00'), card(1, 'V6-01', { pick_take_id: id(502) }), card(2, 'V6-02', { benched: true }), card(3, 'V6-03')],
			assets: [asset(0, 0, 'image', 'grid/P01-01.jpg'), asset(1, 1, 'video', 'seedance/old.mp4'), asset(2, 1, 'video', 'seedance/V6%2001.mp4'), asset(3, 2, 'image', 'grid/unused.jpg'), { ...asset(4, 3, 'image', 'x.jpg'), url: 'https://elsewhere.example/x.jpg' }],
			cuts: [{
				cut_id: id(900), name: 'Cut 1', version: 1, locked: true, locked_at: '2026-10-02T00:00:00.000Z', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z',
				entries: [{ entry_id: id(901), card_id: id(1), asset_id: id(502), in_s: 0.5, out_s: 4.5 }],
				versions: [{ version: 1, locked_at: '2026-10-02T00:00:00.000Z', entries: [{ entry_id: id(901), card_id: id(1), asset_id: id(502), in_s: 0.5, out_s: 4.5 }],
					sound: { layers: { take: { gain_db: 0, mute: false }, ambience: { gain_db: 0, mute: false }, music: { gain_db: 0, mute: false }, effects: { gain_db: 0, mute: false } }, effects: [], crossfade_s: 0.1, duck_db: -8, limiter_db: -1,
						export: { built_at: '2026-10-02T00:00:00.000Z', folder: 'x', mp4: file('export/a-v1/cut-1-v1.mp4'), fcpxml: '', files: [], drafts: [] } } }]
			}]
		} as unknown as ProductionState;
		const saved = await gateway.saveProduction({ command: 'save_production', project_id: p, expected_version: created.data.version, production });
		if (!saved.ok) throw new Error(saved.error.message);

		// Cuts change only through cut commands (a production save keeps the stored ones): give the snapshot its cut directly.
		const project = { ...saved.data, production: { ...saved.data.production, cuts: production.cuts } };
		const snap = buildSnapshot(project, { show_prompts: false, now: '2026-10-05T00:00:00.000Z' });
		expect(snap.slug).toBe('blood-rush-trailer');
		expect(snap.beats.map((b) => [b.title, b.order])).toEqual([['V6-00', 0], ['V6-01', 1], ['V6-03', 2], ['V6-02', null]]);
		// A take outside the project files cannot be published: the beat shows without one.
		expect(snap.beats[2].take).toBeNull();
		// The pick wins over the newest take; encoded names are decoded; an outside URL is left out.
		expect(snap.beats[1].take).toEqual({ file: 'seedance/V6 01.mp4', kind: 'video', mime: 'video/mp4' });
		expect(snap.beats[0].take?.file).toBe('grid/P01-01.jpg');
		expect(snap.beats[0].prompts).toBeUndefined();
		expect(snap.cuts[0]).toMatchObject({ name: 'Cut 1', version: 1, locked: true, length_s: 4, film: { file: 'export/a-v1/cut-1-v1.mp4', kind: 'video' } });
		expect(snap.cuts[0].entries[0]).toMatchObject({ beat_id: id(1), in_s: 0.5, out_s: 4.5 });
		// Only what the snapshot shows gets copied: not the old take, not the outside URL.
		expect(snap.files).toEqual(['export/a-v1/cut-1-v1.mp4', 'grid/P01-01.jpg', 'grid/unused.jpg', 'seedance/V6 01.mp4']);
		expect(indexEntryOf(snap)).toMatchObject({ slug: 'blood-rush-trailer', poster: 'grid/P01-01.jpg', beats: 4, cuts: 1, episode: null });

		const withPrompts = buildSnapshot(project, { show_prompts: true, now: '2026-10-05T00:00:00.000Z' });
		expect(withPrompts.beats[0].prompts).toEqual({ image: 'image prompt 0', video: 'video prompt 0' });
	});

	test('only project files become media; paths cannot climb out', () => {
		expect(mediaOf('p1', '/api/projects/p1/files/a/b.jpg')).toEqual({ file: 'a/b.jpg', kind: 'image', mime: 'image/jpeg' });
		expect(mediaOf('p1', '/api/projects/p2/files/a.jpg')).toBeNull();
		expect(mediaOf('p1', '/api/projects/p1/files/../secret.jpg')).toBeNull();
		expect(mediaOf('p1', '/api/projects/p1/files/a.txt')).toBeNull();
		expect(slugOf('Blood Rush · EP01 — The Late Shift')).toBe('blood-rush-ep01-the-late-shift');
	});
});
