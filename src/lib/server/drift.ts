import type { Project } from '$lib/domain/schemas';
import { bareId, type SeriesReference } from '$lib/domain/notion-series';
import { kindOf, sameName, type PrepFile, type PrepKind } from '$lib/domain/prep';
import { readReferences, type NotionApi } from './notion';
import { addPrepEntry, prepContext, prepView, readPrep, type PrepDeps } from './prep';
import { driftItems, seriesIdOf, type DriftPrepEntry, type DriftReport, type DriftSheet } from '$lib/domain/drift';
import { REFERENCE_FOLDERS } from '$lib/domain/series-tree';
import type { ReviewRoomClient } from './review-room';
import { isHandle } from '$lib/domain/handles';
import { richText } from './story-writer';

/**
 * The drift check's server side (spec GitHub #28 / V1S-506, ADR 0012). Notion is the master of names: Drift 02
 * (GitHub #30 / V1S-508) adds `addReference`, the one way a reference is added from the app. Drift 03 (GitHub #32 /
 * V1S-510) adds `checkDrift`, which only reads; its "add to Notion" is `addReference` on the project it was found in.
 */

type Failure = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Failure => ({ ok: false, status, message });

export type AddReferenceDeps = Pick<PrepDeps, 'projectRoot' | 'series' | 'notion'> & Partial<Pick<PrepDeps, 'store'>>;
export interface AddReferenceInput {
	kind: PrepKind;
	/** The exact name, as the operator typed it. */
	name: string;
	/** A short `@` name; written only when the operator gave one. */
	handle?: string;
	/** The Notion scenes it was found in ("Found in the story"); ids that are not the series' Notion scenes are refused. */
	scene_ids?: string[];
	/** The spellings it had in this project's Prep before its name was settled (a drift item), so its Prep work moves to the new page. */
	former_names?: string[];
}

const KIND_IN_NOTION: Record<PrepKind, string> = { character: 'Character', location: 'Location', prop: 'Prop' };
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '');

/**
 * Adds a character, location or prop: its Notion References page first (Name, Kind, Handles when given, Scenes
 * when added from a scene, and nothing else), then the series record re-read from Notion so the new page id is
 * known, then the Prep entry linked to that page. If Notion refuses or times out nothing is added anywhere.
 */
export async function addReference(deps: AddReferenceDeps, project: Project, input: AddReferenceInput): Promise<{ ok: true; page_id: string; prep: PrepFile } | Failure> {
	const name = input.name.trim();
	if (!name) return fail(400, 'Give the reference a name');
	if (name.length > 200) return fail(400, 'That name is too long (200 characters at most)');
	const typed = input.handle?.trim() ?? '';
	const handle = typed ? (typed.startsWith('@') ? typed : `@${typed}`) : null;
	if (handle && !isHandle(handle)) return fail(400, `${handle} is not a handle: one word after @, letters, digits, _ or -`);
	if (!deps.notion) return fail(503, 'Notion is not connected, so nothing was added. Add the Notion key in Settings and try again.');
	const { record } = await prepContext(deps, project);
	if (!record) return fail(409, 'This project is not part of a Notion series, so a reference cannot be added yet');
	const source = record.references?.source;
	if (!source || !record.references?.check?.ok) return fail(409, `${record.title} has no References database in Notion that the app can write to; re-check the series`);
	const seriesScenes = new Set(record.episodes.flatMap((episode) => episode.scene_ids.map(bareId)));
	const scenes = [...new Set((input.scene_ids ?? []).map(bareId))];
	const outside = scenes.filter((scene) => !seriesScenes.has(scene));
	if (outside.length) return fail(400, 'That scene is not in this series');
	const missing = record.references.check.optionalMissing;
	if (handle && missing.includes('Handles')) return fail(409, `${record.title}'s References database has no Handles column, so the handle cannot be written; add it in Notion or leave the handle out`);
	if (scenes.length && missing.includes('Scenes')) return fail(409, `${record.title}'s References database has no Scenes column, so the scene cannot be linked; add it in Notion and re-check the series`);

	const api: NotionApi = deps.notion;
	const kind = KIND_IN_NOTION[input.kind];
	let current: SeriesReference[];
	try { current = await readReferences(api, source); } catch (cause) { return fail(502, `Notion could not be read: ${reason(cause)}. Nothing was added.`); }
	const taken = current.find((ref) => kindOf(ref.kind) === input.kind && sameName(ref.name, name));
	if (taken) return fail(409, `${taken.name} is already a ${input.kind} in Notion`);
	const handleOwner = handle ? current.find((ref) => ref.handles.some((h) => h.toLowerCase() === handle.toLowerCase())) : undefined;
	if (handle && handleOwner) return fail(409, `${handle} already points at ${handleOwner.name}`);

	const properties: Record<string, unknown> = {
		Name: { title: [{ type: 'text', text: { content: name } }] },
		Kind: { select: { name: kind } },
		...(handle ? { Handles: richText(handle) } : {}),
		...(scenes.length ? { Scenes: { relation: scenes.map((id) => ({ id })) } } : {})
	};
	let pageId: string;
	try { pageId = bareId((await api.createPage(source, properties)).id); } catch (cause) { return fail(502, `Notion did not add ${name}: ${reason(cause)}. Nothing was added.`); }

	// The page exists now. Re-read References so the record holds Notion's own row; should that read fail, keep
	// what was written so the new page is never left out of the app.
	const written: SeriesReference = { page_id: pageId, name, kind, role: '', handles: handle ? [handle] : [], file_name: '', name_on_sheet: false, scene_ids: scenes };
	const fresh = await readReferences(api, source).catch(() => current);
	const items = fresh.some((ref) => ref.page_id === pageId) ? fresh : [...fresh, written];
	try {
		await deps.series.update(record.series_id, (now) => ({ ...now, references: { ...(now.references ?? record.references!), items } }));
		return { ok: true, page_id: pageId, prep: await addPrepEntry(deps, project.project_id, input.kind, name, pageId, input.former_names?.map((one) => one.trim()).filter(Boolean)) };
	} catch (cause) {
		return fail(500, `${name} is in Notion now, but the app could not save it: ${reason(cause)}. Re-check the series to bring it in.`);
	}
}

export interface CheckDriftDeps {
	projectRoot: string;
	series: PrepDeps['series'];
	store: PrepDeps['store'];
	notion: NotionApi | null;
	/** Review Room; null when it is not configured here (the check then compares Notion and Prep only). */
	client: Pick<ReviewRoomClient, 'changes'> | null;
}

/**
 * The drift check: reads Notion's References, every series project's Prep and Review Room's reference folders (from
 * the series project's change feed, from the start), and returns what is out of step. It writes nothing anywhere.
 */
export async function checkDrift(deps: CheckDriftDeps, project: Project): Promise<{ ok: true; report: DriftReport } | Failure> {
	const { record } = await prepContext(deps, project);
	if (!record) return fail(409, 'This project is not part of a Notion series, so there is nothing to compare');
	const source = record.references?.source;
	if (!source) return fail(409, `${record.title} has no References database in Notion; re-check the series`);
	if (!deps.notion) return fail(503, 'Notion is not connected, so the check cannot read the references. Add the Notion key in Settings.');

	let notion: SeriesReference[];
	try { notion = await readReferences(deps.notion, source); } catch (cause) { return fail(502, `Notion could not be read: ${reason(cause)}`); }

	// The project asking comes first (an item found there is added from it); the series' other projects by title.
	const others: Project[] = [];
	for (const summary of await deps.store.listProjects()) {
		if (summary.project_id === project.project_id) continue;
		const read = await deps.store.readProject(summary.project_id).catch(() => null);
		if (read && seriesIdOf(read) === record.series_id) others.push(read);
	}
	const projects = [project, ...others.toSorted((a, b) => a.title.localeCompare(b.title))];
	const prep: DriftPrepEntry[] = [];
	const skipped: string[] = [];
	for (const entry of projects) {
		// One project's Prep that cannot be read is named in the report; it does not stop the check of the rest.
		const view = await prepView(deps, entry).catch((cause) => fail(500, reason(cause)));
		if (!view.ok) { skipped.push(entry.title); continue; }
		const at = { project_id: entry.project_id, project_title: entry.title };
		for (const item of view.items) prep.push({ ...at, kind: item.entry.kind, name: item.entry.name, reference_page_id: item.entry.reference_page_id });
		// Work kept under a second spelling of the same entry (Mara’s / Mara's dorm room) is listed once in Prep;
		// its other spelling is still in the file, so the check shows both.
		for (const key of Object.keys((await readPrep(deps.projectRoot, entry.project_id)).entries)) {
			const kind = key.match(/^(character|location|prop):(.+)$/);
			if (kind) prep.push({ ...at, kind: kind[1] as DriftPrepEntry['kind'], name: kind[2], reference_page_id: null });
		}
	}

	let sheets: DriftSheet[] | null = null;
	const room = record.review_room;
	if (deps.client && room) {
		const folderKey = new Map(REFERENCE_FOLDERS.flatMap(({ key }) => (room.folders[key] ? [[room.folders[key], key] as const] : [])));
		try {
			const feed = await deps.client.changes(room.project_id, '0');
			const removed = new Set((feed.removedAssets ?? []).map((asset) => asset.assetId));
			sheets = feed.assets.filter((asset) => asset.folderId && folderKey.has(asset.folderId) && !removed.has(asset.assetId))
				.map((asset) => ({ asset_id: asset.assetId, code: asset.assetCode, folder_key: folderKey.get(asset.folderId!)!, title: asset.title }));
		} catch (cause) { return fail(502, `Review Room could not be read: ${reason(cause)}`); }
	}

	const items = driftItems({ show_code: record.show_code, notion: notion.map(({ page_id, name, kind }) => ({ page_id, name, kind })), prep, sheets: sheets ?? [] });
	return { ok: true, report: { series_title: record.title, items, read: { notion: notion.length, projects: projects.map((entry) => ({ project_id: entry.project_id, title: entry.title })), sheets: sheets?.length ?? null, skipped } } };
}
