import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { applyPushCut } from '../../src/lib/domain/cuts';
import { playItemFor, slateAssetId, slateFor } from '../../src/lib/domain/slate';
import { projectSchema, productionStateSchema, type Project } from '../../src/lib/domain/schemas';
import { ensureSlate, wrap } from '../../src/lib/server/slate';

const NOW = '2026-11-22T08:00:00.000Z';
const card = (id: string, order: number, extra: object = {}) => ({ card_id: id, group_id: 'g', order, title: `Shot ${id}`, beat: `Kai ${id}`, purpose: 'Story', duration_ms: 2500, image_prompt: 'x', video_prompt: 'x', status: 'draft' as const, ...extra });
function project(): Project {
	return projectSchema.parse({
		schema_version: 1, project_id: 'p1', title: 'TR999', created_at: NOW, updated_at: NOW, version: 3,
		stage: { id: 'S0', state: 'BLOCKED', confidence: null }, seed: { seed_id: 's1', title: 'TR999', brief: '', creative_focus: 'full room', created_by: 'test', created_at: NOW },
		review_room: { project_id: 'room', folder_id: 'f', code: 'TR999', show_code: 'ZZZ', shots: { b: { code: 'ZZZ_TR999_PCK_0020', folder_id: 'f' } } },
		production: productionStateSchema.parse({
			groups: [{ group_id: 'g', name: 'TR999 08 · Red', created_at: NOW }],
			cards: [card('a', 0), card('b', 1), card('c', 2, { benched: true }), card('d', 3)],
			assets: [
				{ asset_id: 'a1', card_id: 'a', kind: 'video', name: 'a1.mp4', mime_type: 'video/mp4', url: '/files/a1.mp4', created_at: NOW },
				{ asset_id: 'd1', card_id: 'd', kind: 'image', name: 'd1.png', mime_type: 'image/png', url: '/files/d1.png', created_at: NOW }
			]
		})
	});
}

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('a shot plays as its video pick; a missing shot as its text card; benched shots and still picks are skipped', () => {
	const p = project();
	const [a, b, c, d] = p.production.cards;
	expect(playItemFor(p, a)).toEqual({ id: 'a', title: 'Shot a', src: '/files/a1.mp4', assetId: 'a1' });
	expect(playItemFor(p, b)).toEqual({ id: 'b', title: 'Shot b', src: '/api/projects/p1/slate/b', assetId: 'slate-b' });
	expect(playItemFor(p, c)).toBeNull();
	expect(playItemFor(p, d)).toBeNull();
	expect(slateFor(p, b)).toEqual({ code: 'ZZZ_TR999_PCK_0020', order: 'TR999 08 · Red · shot 2 of 4', title: 'Shot b', beat: 'Kai b', duration_s: 2.5 });
});

test('a cut can hold a missing shot as its own text card, never as another shot\'s', () => {
	const { production } = project();
	const ok = applyPushCut(production, { cut_id: 'cut', name: 'Rough', entries: [{ card_id: 'a', asset_id: 'a1', in_s: 0, out_s: 1 }, { card_id: 'b', asset_id: slateAssetId('b'), in_s: 0, out_s: 2.5 }] }, () => crypto.randomUUID(), NOW);
	expect(ok.ok).toBeTrue();
	const wrong = applyPushCut(production, { cut_id: 'cut2', name: 'Wrong', entries: [{ card_id: 'a', asset_id: slateAssetId('b'), in_s: 0, out_s: 1 }] }, () => crypto.randomUUID(), NOW);
	expect(wrong.ok).toBeFalse();
});

test('long text wraps on spaces into a fixed number of lines', () => {
	expect(wrap('one two three four five', 9, 3)).toEqual(['one two', 'three', 'four five']);
	expect(wrap('a b c d e f g h', 3, 2).length).toBe(2);
});

test('the text card is a 1080p video of the planned length with a silent track, made once per content', async () => {
	const root = await mkdtemp(join(tmpdir(), 'csp-slate-')); roots.push(root);
	const p = project();
	const first = await ensureSlate(root, p, 'b');
	const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', first.file]).toString());
	expect(Math.abs(Number(probe.format.duration) - 2.5)).toBeLessThan(0.1);
	expect(probe.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(['audio', 'video']);
	expect(probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video')).toMatchObject({ width: 1920, height: 1080 });
	expect(first.url).toBe(`/api/projects/p1/files/slates/${first.name}`);
	expect((await ensureSlate(root, p, 'b')).file).toBe(first.file);
}, 60_000);
