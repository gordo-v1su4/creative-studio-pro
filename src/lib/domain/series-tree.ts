import { episodeCode, sceneOrder } from './shot-codes';

/**
 * The series tree in Review Room (V1S-275, ADR 0001): one Review Room project per series holding a series-level
 * `_Deliverables` folder and, per imported episode, `EP101 — Title` with its own `_Deliverables` and one
 * `010 PAR — Scene title` folder per scene. Every folder is created locked, owned by this app.
 */

export const DELIVERABLES = '_Deliverables';

/** One folder the tree should have: a stable key (what it is), its title, and its parent's key (null = project root). */
export interface TreeFolder { key: string; title: string; parent: string | null }

export interface TreeEpisode {
	episode_page_id: string;
	number: number;
	season: number | null | undefined;
	title: string;
	/** Scenes in story order, each with its scene code once assigned. */
	scenes: Array<{ page_id: string; title: string; code?: string }>;
}

/** "EP01 — The Late Shift" → "The Late Shift"; "P01 — 2:47 AM (Teaser)" → "2:47 AM (Teaser)"; "2:47 AM" stays (a time, not a prefix). */
export const bareTitle = (title: string) => title.replace(/^\s*(?:EP?\s*\d+|P\d+[A-Z]?|\d+)\s*(?:[—–-]|:(?=\s))\s*/i, '').trim() || title.trim();

/** The folders a series should have, parents before children. Scenes without a code yet are left out. */
export function seriesTree(episodes: TreeEpisode[]): TreeFolder[] {
	const folders: TreeFolder[] = [{ key: 'deliverables', title: DELIVERABLES, parent: null }];
	for (const episode of episodes.toSorted((a, b) => a.number - b.number)) {
		const ep = `ep:${episode.episode_page_id}`;
		folders.push({ key: ep, title: `${episodeCode(episode.season, episode.number)} — ${bareTitle(episode.title)}`, parent: null });
		folders.push({ key: `${ep}:deliverables`, title: DELIVERABLES, parent: ep });
		episode.scenes.forEach((scene, i) => {
			if (scene.code) folders.push({ key: `scene:${scene.page_id}`, title: `${sceneOrder(i)} ${scene.code} — ${bareTitle(scene.title)}`, parent: ep });
		});
	}
	return folders;
}

export interface RemoteFolder { id: string; title: string; parentFolderId: string | null; locked?: boolean; ownedByCaller?: boolean }
export type TreeStep =
	| { kind: 'create'; folder: TreeFolder }
	| { kind: 'rename'; folder: TreeFolder; id: string }
	| { kind: 'keep'; folder: TreeFolder; id: string };

/**
 * What to do to make Review Room match: folders already known (by key → id) are kept or renamed; unknown ones
 * are adopted when a locked folder this app owns already has that title under that parent, else created.
 */
export function planTree(wanted: TreeFolder[], known: Record<string, string>, remote: RemoteFolder[]): TreeStep[] {
	const byId = new Map(remote.map((folder) => [folder.id, folder]));
	const ids: Record<string, string> = {};
	const steps: TreeStep[] = [];
	for (const folder of wanted) {
		const parentId = folder.parent === null ? null : ids[folder.parent] ?? null;
		const knownId = known[folder.key];
		const existing = knownId ? byId.get(knownId) : remote.find((r) => r.ownedByCaller && r.title === folder.title && (r.parentFolderId ?? null) === parentId);
		if (existing) {
			ids[folder.key] = existing.id;
			steps.push(existing.title === folder.title ? { kind: 'keep', folder, id: existing.id } : { kind: 'rename', folder, id: existing.id });
		} else steps.push({ kind: 'create', folder });
	}
	return steps;
}
