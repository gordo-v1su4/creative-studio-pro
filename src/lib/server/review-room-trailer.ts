import type { Project } from '$lib/domain/schemas';
import { sceneOrder, SHOT_MAX, SHOT_STEP, shotNumberText } from '$lib/domain/shot-codes';
import { idempotencyKey, type ReviewRoomClient } from './review-room';

type Connection = NonNullable<Project['review_room']>;
type RemoteFolder = Awaited<ReturnType<ReviewRoomClient['folders']>>[number];

/**
 * Register a standalone trailer's shots in Review Room.
 * With `scenes` (the story's sequences, in story order, each with a three-letter code) the tree matches the
 * episodes: `TR110 — Teaser Trailer / 010 DRP — The sealed drop / BLR_TR110_DRP_0010`, one asset per shot,
 * takes as its versions; cards outside those sequences (source clips, cuts) get no code. Without `scenes`,
 * every board card gets its own flat `BLR_TR100_SHT_0010` folder, as the first trailers did.
 * Codes never change once given: reordering keeps them, and a shot added later takes a number in between.
 */
export async function connectTrailer(client: ReviewRoomClient, project: Project, input: {
	project_id: string; folder_id: string; show_code: string; code: string; reference_series_id?: string;
	scenes?: Array<{ group_id: string; code: string }>;
}): Promise<Connection> {
	const { scenes: asked, ...connection } = input;
	const folders = await client.folders(input.project_id);
	const root = folders.find((folder) => folder.id === input.folder_id);
	if (!root?.ownedByCaller) throw new Error('The trailer folder must be connected to Creative Studio Pro first');
	const known = project.review_room;
	// A reconnect without scenes (new planned shots) keeps the scene folders it already has.
	const wanted = asked ?? (known?.scenes ? Object.entries(known.scenes).map(([group_id, scene]) => ({ group_id, code: scene.code })) : undefined);
	if (known && (known.project_id !== input.project_id || known.folder_id !== input.folder_id || known.code !== input.code || known.show_code !== input.show_code)) throw new Error('This trailer already has a different connection');
	const shots = { ...known?.shots };
	if (wanted?.length) return { ...connection, ...(await sceneTree(client, project, input, root, folders, shots, wanted)), cursor: known?.cursor };

	let next = Math.max(0, ...Object.values(shots).map((shot) => Number(shot.code.split('_').at(-1)) || 0)) + 10;
	for (const card of project.production.cards.toSorted((a, b) => a.order - b.order)) {
		if (shots[card.card_id]) continue;
		const code = `${input.show_code}_${input.code}_SHT_${String(next).padStart(4, '0')}`;
		const title = `${code} — ${card.title}`.slice(0, 200);
		const existing = folders.find((f) => f.parentFolderId === root.id && f.ownedByCaller && f.title.startsWith(code + ' —'));
		const folder = existing ?? await client.createFolder(input.project_id, title, root.id, idempotencyKey('trailer-shot', project.project_id, card.card_id));
		shots[card.card_id] = { code, folder_id: folder.id }; next += 10;
	}
	return { ...connection, shots, cursor: known?.cursor };
}

/** "TR110-02-01a · …" → 15: the shot's planned number (step 10), "a" for an insert after it. */
export function plannedShot(title: string): number | null {
	const match = /-(\d{1,3})([a-z])?\s*·/.exec(title);
	if (!match) return null;
	const base = Number(match[1]) * SHOT_STEP;
	return match[2] ? base + (match[2] === 'a' ? 5 : match[2] === 'b' ? 7 : 8) : base;
}

/** The next step of 10 above `n` (12 → 20, 20 → 30). */
const nextStep = (n: number) => Math.floor(n / SHOT_STEP) * SHOT_STEP + SHOT_STEP;

/** A free number strictly between two shots, nearest their midpoint; `last` when there is none (the caller refuses it). */
function freeBetween(last: number, after: number, used: Set<number>): number {
	const mid = Math.floor((last + after) / 2);
	for (let d = 0; mid - d > last || mid + d < after; d++) {
		if (mid - d > last && !used.has(mid - d)) return mid - d;
		if (mid + d < after && !used.has(mid + d)) return mid + d;
	}
	return last;
}

async function sceneTree(
	client: ReviewRoomClient, project: Project,
	input: { project_id: string; show_code: string; code: string },
	root: RemoteFolder, folders: RemoteFolder[], shots: Connection['shots'], wanted: Array<{ group_id: string; code: string }>
): Promise<Pick<Connection, 'shots' | 'scenes'>> {
	const scenes = { ...project.review_room?.scenes };
	const codes = new Set<string>();
	for (const [i, want] of wanted.entries()) {
		const group = project.production.groups?.find((entry) => entry.group_id === want.group_id);
		if (!group) throw new Error(`No board group ${want.group_id}`);
		if (!/^[A-Z]{3}$/.test(want.code)) throw new Error(`Scene code ${want.code} must be three capital letters`);
		const scene = scenes[group.group_id];
		if (scene && scene.code !== want.code) throw new Error(`${group.name} already uses scene code ${scene.code}`);
		if (codes.has(want.code)) throw new Error(`Scene code ${want.code} is used twice`);
		// A scene code names one sequence for good, including sequences not in this request.
		const owner = Object.entries(scenes).find(([groupId, stored]) => stored.code === want.code && groupId !== group.group_id);
		if (owner) throw new Error(`Scene code ${want.code} already belongs to another sequence`);
		codes.add(want.code);
		let folderId = scene?.folder_id;
		if (!folderId) {
			const prefix = `${sceneOrder(i)} ${want.code} —`;
			const title = `${prefix} ${group.name.replace(/^TR\d{3}\s+\d+\s*·\s*/, '')}`.slice(0, 200);
			const existing = folders.find((f) => f.parentFolderId === root.id && f.ownedByCaller && f.title.startsWith(prefix));
			folderId = (existing ?? await client.createFolder(input.project_id, title, root.id, idempotencyKey('trailer-scene', project.project_id, group.group_id))).id;
			scenes[group.group_id] = { code: want.code, folder_id: folderId };
		}

		// Shot numbers: kept when given; new ones take their planned number, else the gap after the shot before.
		const cards = project.production.cards.filter((card) => card.group_id === group.group_id).toSorted((a, b) => a.order - b.order);
		const numberOf = (cardId: string) => { const code = shots[cardId]?.code; return code ? Number(code.split('_').at(-1)) : null; };
		// Every number this scene ever gave stays taken, even for shots since removed or moved: its code still names a Review Room asset.
		const scenePrefix = `${input.show_code}_${input.code}_${want.code}_`;
		const used = new Set(Object.values(shots).filter((shot) => shot.code.startsWith(scenePrefix)).map((shot) => Number(shot.code.slice(scenePrefix.length))));
		let last = 0;
		for (const [at, card] of cards.entries()) {
			const have = numberOf(card.card_id);
			if (have !== null) { last = have; continue; }
			// A shot the approved shot list already named is stored under that name, whichever scene it sits in now.
			if (card.scene_code && card.shot_number) {
				const code = `${input.show_code}_${input.code}_${card.scene_code}_${shotNumberText(card.shot_number)}`;
				if (Object.values(shots).some((shot) => shot.code === code)) throw new Error(`${code} already names another shot in Review Room`);
				shots[card.card_id] = { code, folder_id: folderId };
				if (card.scene_code === want.code) { used.add(card.shot_number); last = card.shot_number; }
				continue;
			}
			const after = cards.slice(at + 1).map((c) => numberOf(c.card_id)).find((n): n is number => n !== null);
			const planned = plannedShot(card.title);
			const shot = planned !== null && planned > last && (after === undefined || planned < after) && !used.has(planned) ? planned
				: after === undefined ? nextStep(Math.max(last, ...used)) : freeBetween(last, after, used);
			if (shot <= last || used.has(shot) || shot > SHOT_MAX) throw new Error(`No free shot number after ${shotNumberText(last)} in ${group.name}`);
			used.add(shot); last = shot;
			shots[card.card_id] = { code: `${input.show_code}_${input.code}_${want.code}_${shotNumberText(shot)}`, folder_id: folderId };
		}
	}
	return { shots, scenes };
}
