import type { Project } from '$lib/domain/schemas';
import { bareId, type SeriesReference } from '$lib/domain/notion-series';
import { kindOf, sameName, type PrepFile, type PrepKind } from '$lib/domain/prep';
import { readReferences, type NotionApi } from './notion';
import { addPrepEntry, prepContext, prepView, readPrep, type PrepDeps } from './prep';
import { driftItems, historyOf, isMarkedOld, markedOld, seriesIdOf, type DriftPrepEntry, type DriftReport, type DriftSheet, type RenameChoice } from '$lib/domain/drift';
import { REFERENCE_FOLDERS, referenceCode, referenceFolderKey } from '$lib/domain/series-tree';
import { ReviewRoomError, type ReviewRoomClient } from './review-room';
import type { SeriesRecord } from './series';
import { isHandle } from '$lib/domain/handles';
import { richText } from './story-writer';
import { prepStanding, type StandingPrepEntry } from '$lib/domain/drift-standing';
import type { MediaProbe } from './media-probe';

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
	client: Pick<ReviewRoomClient, 'changes' | 'versionMetadata'> | null;
	/** Drift 08: reads each Prep sheet's size, so one under 2048 px is offered an upscale or a remake; omitted, sizes are not read. */
	probe?: (file: string) => Promise<MediaProbe>;
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
	/** The asking project's entries as its Prep lists them, for where each stands (Drift 09). */
	const own: StandingPrepEntry[] = [];
	for (const entry of projects) {
		// One project's Prep that cannot be read is named in the report; it does not stop the check of the rest.
		const view = await prepView(deps, entry).catch((cause) => fail(500, reason(cause)));
		if (!view.ok) { skipped.push(entry.title); continue; }
		const at = { project_id: entry.project_id, project_title: entry.title };
		for (const item of view.items) {
			const result = item.state.result;
			// A reference the series already has a Review Room sheet for has no picture to send.
			const inRoom = !!item.entry.reference_page_id && !!record.reference_files?.[item.entry.reference_page_id];
			const size = result && !result.uploaded && !inRoom && deps.probe ? await deps.probe(result.file).catch(() => ({} as MediaProbe)) : null;
			const picture = result && size?.width && size.height ? { width: size.width, height: size.height, url: result.url, entry_key: item.entry.key } : null;
			prep.push({ ...at, kind: item.entry.kind, name: item.entry.name, reference_page_id: item.entry.reference_page_id, picture });
		}
		if (entry === project) for (const item of view.items) own.push({ key: item.entry.key, kind: item.entry.kind, name: item.entry.name, reference_page_id: item.entry.reference_page_id });
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
		const client = deps.client;
		try {
			// Drift 04: a sheet whose current version is marked old is history, read from its metadata. Drift 06: so are
			// the Notion page it was sent from and the name it was sent under, to catch a rename.
			sheets = await Promise.all((await referenceSheets(client, room)).map(async ({ asset, folder_key }) => {
				const metadata = asset.currentVersionId ? (await client.versionMetadata(asset.currentVersionId)).metadata : {};
				return { asset_id: asset.assetId, code: asset.assetCode, folder_key, title: asset.title, old: isMarkedOld(metadata), ...sentFrom(metadata) };
			}));
		} catch (cause) { return fail(502, `Review Room could not be read: ${reason(cause)}`); }
	}

	const references = notion.flatMap(({ page_id, name, kind }) => { const known = kindOf(kind); return known ? [{ page_id, name, kind: known }] : []; });
	const refs = notion.map(({ page_id, name, kind }) => ({ page_id, name, kind }));
	const sent = Object.entries(record.reference_files ?? {}).map(([page_id, file]) => ({ page_id: bareId(page_id), asset_id: file.asset_id, code: file.code, file_name: file.file_name }));
	const items = driftItems({ show_code: record.show_code, notion: refs, prep, sheets: sheets ?? [], sent });
	// Old sheets (Drift 04) are history; Prep's standing skips them like the check does.
	const standing = { project_id: project.project_id, review_room_read: sheets !== null, ...prepStanding({ show_code: record.show_code, notion: refs, prep: own, sheets: (sheets ?? []).filter((sheet) => !sheet.old), sent: Object.keys(record.reference_files ?? {}) }) };
	return { ok: true, report: { series_title: record.title, items, standing, read: { notion: notion.length, projects: projects.map((entry) => ({ project_id: entry.project_id, title: entry.title })), sheets: sheets?.length ?? null, skipped }, references } };
}

/** The Notion page and name a reference upload wrote into the sheet's metadata (as custom fields), if any. */
function sentFrom(metadata: Record<string, unknown>): { page_id: string | null; reference_name: string | null } {
	const fields = Array.isArray(metadata.customFields) ? metadata.customFields as Array<{ id?: unknown; value?: unknown }> : [];
	const text = (id: string) => { const value = fields.find((field) => field.id === id)?.value; return typeof value === 'string' && value.trim() ? value.trim() : null; };
	const page = text('notion_page_id');
	return { page_id: page ? bareId(page) : null, reference_name: text('reference') };
}

type ReviewRoomLink = NonNullable<SeriesRecord['review_room']>;
/** The assets in the series' reference folders in Review Room (removed ones left out), from the change feed. */
export async function referenceSheets(client: Pick<ReviewRoomClient, 'changes'>, room: ReviewRoomLink) {
	const folderKey = new Map(REFERENCE_FOLDERS.flatMap(({ key }) => (room.folders[key] ? [[room.folders[key], key] as const] : [])));
	const feed = await client.changes(room.project_id, '0');
	const removed = new Set((feed.removedAssets ?? []).map((asset) => asset.assetId));
	return feed.assets.filter((asset) => asset.folderId && folderKey.has(asset.folderId) && !removed.has(asset.assetId)).map((asset) => ({ asset, folder_key: folderKey.get(asset.folderId!)! }));
}

export interface MarkOldDeps {
	projectRoot: string;
	series: PrepDeps['series'];
	store?: PrepDeps['store'];
	/** Review Room; null when it is not configured here. */
	client: Pick<ReviewRoomClient, 'changes' | 'versionMetadata' | 'putMetadata'> | null;
}

/**
 * "Mark as old" on a drift item (Drift 04, GitHub #33 / V1S-511; ADR 0012): a Review Room sheet no Notion reference
 * uses becomes history. Its current version's metadata is read, the old flag (and the reference it is history of)
 * added, and the rest written back unchanged against the revision read, so an edit made meanwhile is refused, not
 * overwritten. A sheet a reference uses (by its code, or as its picture here) is refused, so an old sheet is never in
 * `reference_files`, which is all Prep, the shot pickers and sends read. If Review Room refuses, nothing changes. The
 * sheet stays visible in Review Room; a new version uploaded to it is current and not old.
 */
export async function markOld(deps: MarkOldDeps, project: Project, input: { asset_id: string; history_of?: string | null }): Promise<{ ok: true; asset_id: string; code: string; history_of: { page_id: string; name: string } | null } | Failure> {
	if (!deps.client) return fail(503, 'Review Room is not configured here, so nothing was marked old');
	const { record } = await prepContext(deps, project);
	if (!record) return fail(409, 'This project is not part of a Notion series');
	const room = record.review_room;
	if (!room) return fail(409, `${record.title} is not linked to Review Room; run the Review Room sync on the Series page`);
	const references = record.references?.items ?? [];
	const history = input.history_of ? references.find((ref) => bareId(ref.page_id) === bareId(input.history_of!)) : undefined;
	if (input.history_of && !history) return fail(400, `That reference is not in ${record.title}; re-check the series`);

	let found: Awaited<ReturnType<typeof referenceSheets>>[number] | undefined;
	try { found = (await referenceSheets(deps.client, room)).find(({ asset }) => asset.assetId === input.asset_id); } catch (cause) { return fail(502, `Review Room could not be read: ${reason(cause)}. Nothing was changed.`); }
	if (!found) return fail(404, `That sheet is not in ${record.title}'s reference folders in Review Room`);
	const { asset } = found;
	const code = asset.assetCode ?? asset.title;
	if (history && referenceFolderKey(history.kind) !== found.folder_key) return fail(400, `${code} is not a ${history.kind.toLowerCase()} sheet, so it cannot be ${history.name}'s history`);
	const user = references.find((ref) => { const folder = referenceFolderKey(ref.kind); return folder && referenceCode(record.show_code, folder, ref.name) === asset.assetCode; });
	if (user) return fail(409, `${code} is ${user.name}'s sheet in Notion, so it is not marked old`);
	const attached = Object.entries(record.reference_files ?? {}).find(([, file]) => file.asset_id === asset.assetId);
	const holder = attached && references.find((ref) => ref.page_id === attached[0]);
	if (attached) return fail(409, `${code} is ${holder?.name ?? 'a reference'}'s picture here, so it is not marked old`);
	if (!asset.currentVersionId) return fail(409, `${code} has no current version in Review Room to mark`);

	const wanted = history ? { page_id: history.page_id, name: history.name } : null;
	try {
		const read = await deps.client.versionMetadata(asset.currentVersionId);
		const had = historyOf(read.metadata);
		const same = isMarkedOld(read.metadata) && (had?.page_id ?? null) === (wanted?.page_id ?? null) && (had?.name ?? null) === (wanted?.name ?? null);
		if (!same) await deps.client.putMetadata(asset.currentVersionId, markedOld(read.metadata, wanted), read.updatedAt);
	} catch (cause) {
		const status = cause instanceof ReviewRoomError && cause.status === 409 ? 409 : 502;
		return fail(status, `Review Room did not mark ${code} as old: ${reason(cause)}. Nothing was changed.`);
	}
	return { ok: true, asset_id: asset.assetId, code, history_of: wanted };

}

/**
 * The check after a series re-check or sync (Drift 09, ADR 0012): run from one of the series' projects (its first
 * imported episode, else any project built from it), since the check covers every project of the series either
 * way. Null when the series has no project yet. It only reads, like `checkDrift`.
 */
export async function checkSeriesDrift(deps: CheckDriftDeps, seriesId: string): Promise<({ ok: true; project_id: string; report: DriftReport }) | Failure | null> {
	const record = await deps.series.read(seriesId);
	if (!record) return null;
	let project: Project | null = null;
	for (const id of Object.values(record.episode_projects)) { project = await deps.store.readProject(id).catch(() => null); if (project) break; }
	if (!project) {
		for (const summary of await deps.store.listProjects()) {
			const read = await deps.store.readProject(summary.project_id).catch(() => null);
			if (read && seriesIdOf(read) === seriesId) { project = read; break; }
		}
	}
	if (!project) return null;
	const checked = await checkDrift(deps, project);
	return checked.ok ? { ok: true, project_id: project.project_id, report: checked.report } : checked;
}

export type AnswerRenameDeps = Omit<CheckDriftDeps, 'client' | 'probe'> & { client: MarkOldDeps['client'] };

/**
 * A rename in Notion after the code is set (Drift 06, GitHub #35 / V1S-516; ADR 0012: a rename is a new reference).
 * The rename is found again by the check (so only what the operator saw can be answered), then one of two answers:
 *
 * - `restore_name` writes the name the sheets carry back to the page's Name in Notion, and nothing else there.
 * - `new_reference` leaves Notion as it is: the page keeps its new name, its sent sheet is let go here, and its old
 *   sheets are marked old as its history. Its next send makes the new name's own code and sheet.
 *
 * There is no answer that follows a rename onto the old code.
 */
export async function answerRename(deps: AnswerRenameDeps, project: Project, input: { page_id: string; choice: RenameChoice }): Promise<{ ok: true; page_id: string; choice: RenameChoice; name: string; marked: string[] } | Failure> {
	const page = bareId(input.page_id);
	if (input.choice === 'restore_name' && !deps.notion) return fail(503, 'Notion is not connected, so the name cannot be put back. Add the Notion key in Settings.');
	if (input.choice === 'new_reference' && !deps.client) return fail(503, 'Review Room is not configured here, so the old sheets cannot be marked old. Nothing was changed.');
	const checked = await checkDrift({ ...deps, probe: undefined }, project);
	if (!checked.ok) return checked;
	const item = checked.report.items.find((entry) => entry.renamed && bareId(entry.renamed.page_id) === page);
	if (!item?.renamed) return fail(409, 'That reference is not renamed in Notion any more; run the check again');
	const { from, to, sheets } = item.renamed;
	const { record } = await prepContext(deps, project);
	if (!record) return fail(409, 'This project is not part of a Notion series');

	if (input.choice === 'restore_name') {
		try { await deps.notion!.updatePage(page, { Name: { title: [{ type: 'text', text: { content: from } }] } }); } catch (cause) { return fail(502, `Notion did not take the name ${from} back: ${reason(cause)}. Nothing was changed.`); }
		try {
			await deps.series.update(record.series_id, (now) => now.references ? { ...now, references: { ...now.references, items: now.references.items.map((ref) => (bareId(ref.page_id) === page ? { ...ref, name: from } : ref)) } } : now);
		} catch (cause) { return fail(500, `${from} is the name in Notion again, but the app could not save it: ${reason(cause)}. Re-check the series to bring it in.`); }
		return { ok: true, page_id: page, choice: input.choice, name: from, marked: [] };
	}

	// A new reference: the app takes Notion's name, and lets go of the sheet it sent under the old one, so the next
	// send gives the new name its own code (a sheet still attached here is never marked old, so this comes first).
	const kept = Object.entries(record.reference_files ?? {}).find(([id]) => bareId(id) === page);
	try {
		await deps.series.update(record.series_id, (now) => {
			const files = Object.fromEntries(Object.entries(now.reference_files ?? {}).filter(([id]) => bareId(id) !== page));
			const references = now.references ? { ...now.references, items: now.references.items.map((ref) => (bareId(ref.page_id) === page ? { ...ref, name: to } : ref)) } : now.references;
			return { ...now, references, reference_files: files };
		});
	} catch (cause) { return fail(500, `The app could not let go of ${from}'s sheet: ${reason(cause)}. Nothing was changed.`); }
	const marked: string[] = [];
	for (const sheet of sheets) {
		const done = await markOld(deps, project, { asset_id: sheet.asset_id, history_of: page });
		if (done.ok) { marked.push(done.code); continue; }
		if (marked.length) {
			// An old sheet is never a reference's picture, so the one let go stays let go; the rest can be marked from the check.
			return fail(done.status, `${marked.join(', ')} ${marked.length === 1 ? 'is' : 'are'} old now and ${to} waits for a new sheet, but ${done.message.replace(/ Nothing was changed\.$/, '')}. Run the check again for the rest.`);
		}
		// Nothing marked: the reference keeps the sheet it had, as it was.
		const restored = !kept || await deps.series.update(record.series_id, (now) => ({ ...now, reference_files: { ...(now.reference_files ?? {}), [kept[0]]: kept[1] } })).then(() => true, () => false);
		return fail(done.status, restored ? done.message : `${done.message.replace(/ Nothing was changed\.$/, '')}, and the app could not give ${to} back its old sheet; re-check the series.`);
	}
	return { ok: true, page_id: page, choice: input.choice, name: to, marked };
}
