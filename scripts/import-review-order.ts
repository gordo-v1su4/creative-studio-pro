// Usage: bun scripts/import-review-order.ts <project-id> <review-order.json> [--base http://localhost:5174]
// Loads an ordered review list (beats → takes) into a project's production workspace through the
// running app's API: one story card per beat, every take attached as a video asset served from the
// project's files/ folder. The first take is the pick, so it is attached last (cards show the latest).
// Re-running replaces the cards with the same prefix and leaves every other card untouched.
import { resolve } from 'node:path';
// Clips live under the repo's data/projects/<id>/files (the folder the files route serves).

interface Take { file: string; in?: number; out?: number; note?: string }
interface Beat { title: string; beat: string; takes: Take[] }
interface ReviewOrder { prefix: string; clip_dir: string; note?: string; beats: Beat[] }

const args = process.argv.slice(2);
const [projectId, orderFile] = args.filter((arg) => !arg.startsWith('--'));
const baseFlag = args.indexOf('--base');
const base = baseFlag >= 0 ? args[baseFlag + 1] : 'http://localhost:5174';
if (!projectId || !orderFile) {
	console.error('usage: bun scripts/import-review-order.ts <project-id> <review-order.json> [--base url]');
	process.exit(2);
}

const order = (await Bun.file(orderFile).json()) as ReviewOrder;
const filesDir = resolve(import.meta.dir, '..', 'data', 'projects', projectId, 'files');

function seconds(path: string): number {
	const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
	return Number(probe.stdout.toString().trim()) || 0;
}
const span = (take: Take, length: number) => (take.out ?? length) - (take.in ?? 0);
const label = (take: Take) =>
	[take.file, take.in !== undefined || take.out !== undefined ? `use ${take.in ?? 0}–${take.out ?? 'end'} s` : '', take.note ?? ''].filter(Boolean).join(' · ');

const got = await fetch(`${base}/api/projects/${projectId}`);
if (!got.ok) throw new Error(`GET project failed: ${got.status}`);
const { project } = (await got.json()) as { project: { version: number; production: any } };
const production = project.production;
const keep = (id: string) => !id.startsWith(`${order.prefix}-`);
const cards = production.cards.filter((card: any) => keep(card.card_id));
const assets = production.assets.filter((asset: any) => keep(asset.card_id));
const now = new Date().toISOString();

order.beats.forEach((beat, i) => {
	const cardId = `${order.prefix}-${String(i + 1).padStart(2, '0')}`;
	const missing = beat.takes.filter((take) => !Bun.file(resolve(filesDir, order.clip_dir, take.file)).size);
	if (missing.length) throw new Error(`${cardId}: missing ${missing.map((t) => t.file).join(', ')}`);
	const pick = beat.takes[0];
	const pickSeconds = span(pick, seconds(resolve(filesDir, order.clip_dir, pick.file)));
	cards.push({
		card_id: cardId,
		order: cards.length,
		title: `${cardId} — ${beat.title}`,
		beat: beat.beat,
		purpose: `Trailer review · pick: ${label(pick)}${beat.takes.length > 1 ? ` · alternates: ${beat.takes.slice(1).map(label).join(' | ')}` : ''}`,
		duration_ms: Math.min(120_000, Math.max(1, Math.round(pickSeconds * 1000))),
		image_prompt: 'Seedance coverage take — see trailer/prompts/',
		video_prompt: `Seedance 2.5 draft, 480p (temp until up-res). ${order.note ?? ''}`.trim(),
		status: 'draft'
	});
	// Alternates first, pick last: cards render the latest video for their card_id.
	for (const take of [...beat.takes.slice(1), pick]) {
		assets.push({
			asset_id: `${cardId}-${take.file.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '-')}`,
			card_id: cardId,
			kind: 'video',
			name: label(take),
			mime_type: 'video/mp4',
			url: `/api/projects/${projectId}/files/${order.clip_dir}/${take.file}`,
			...(take.in !== undefined ? { in_s: take.in } : {}),
			...(take.out !== undefined ? { out_s: take.out } : {}),
			created_at: now
		});
	}
});

const saved = await fetch(`${base}/api/projects/${projectId}/production`, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ mode: 'save', expected_version: project.version, production: { ...production, cards, assets } })
});
const body = (await saved.json()) as { ok: boolean; error?: { message: string } };
if (!saved.ok || !body.ok) throw new Error(`save failed: ${saved.status} ${body.error?.message ?? ''}`);
console.log(`Saved ${order.beats.length} ${order.prefix} cards (${cards.length} cards, ${assets.length} assets total).`);
