import type { Project } from '$lib/domain/schemas';
import { bareId } from '$lib/domain/notion-series';
import { kindOf, sheetFileName } from '$lib/domain/prep';
import { referenceCode, referenceFolderKey } from '$lib/domain/series-tree';
import { readReferences, type NotionApi } from './notion';
import { addPrepEntry, prepContext, type PrepDeps } from './prep';
import { markOld, referenceSheets } from './drift';
import { uploadReference, type ReferenceFileDeps } from './reference-files';

/**
 * "Link" on a drift item (Drift 05, GitHub #34 / V1S-515; spec GitHub #28, stories 18-20; ADR 0012): a stray sheet
 * whose name is close to a Notion reference (`BLR_REF_CHR_BRYSON` and Bryson Vane) becomes that reference's. The
 * stray's own file goes up through the reference upload under the Notion name, as that reference's next version,
 * and only once it is in is the stray asset marked old, as that reference's history. If the upload fails or is
 * refused, nothing is marked. A Prep entry under the stray name is then pointed at the Notion page, its work kept.
 * Notion is only read, to be sure the name about to become a code is still the one it gives.
 *
 * Link is one press per item and does not join the batch (Drift 10): each one sends a sheet to Review Room, and there
 * are only ever a few strays.
 */

type Failure = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Failure => ({ ok: false, status, message });
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '');
const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

export interface LinkDeps {
	projectRoot: string;
	series: PrepDeps['series'];
	store?: PrepDeps['store'];
	notion: NotionApi | null;
	/** The reference upload (and its Review Room client); null when Review Room is not configured here. */
	references: ReferenceFileDeps | null;
}

export interface LinkInput {
	/** The Notion reference to link to (the item's `link_to`). */
	page_id: string;
	/** The stray Review Room sheet, when the item has one. */
	asset_id?: string | null;
	/** The stray spellings in this project's Prep, when the item was found there; its entry moves to the Notion page. */
	former_names?: string[];
}

export type LinkResult = {
	ok: true; page_id: string; name: string;
	/** The new version under the Notion name, or null when there was no sheet to send. */
	sent: { code: string; version: number } | null;
	/** The stray marked old, or null when there was none. */
	marked: { code: string } | null;
};

export async function linkSheet(deps: LinkDeps, project: Project, input: LinkInput): Promise<LinkResult | Failure> {
	const formerNames = (input.former_names ?? []).map((name) => name.trim()).filter(Boolean);
	if (!input.asset_id && !formerNames.length) return fail(400, 'Say which sheet or Prep entry to link');
	if (!deps.notion) return fail(503, 'Notion is not connected, so nothing was linked. Add the Notion key in Settings and try again.');
	if (input.asset_id && !deps.references) return fail(503, 'Review Room is not configured here, so nothing was linked');
	const { record } = await prepContext(deps, project);
	if (!record) return fail(409, 'This project is not part of a Notion series');
	const target = record.references?.items.find((ref) => bareId(ref.page_id) === bareId(input.page_id));
	if (!target || !record.references?.source) return fail(400, `That reference is not in ${record.title}; re-check the series`);
	const kind = kindOf(target.kind);
	const folderKey = referenceFolderKey(target.kind);
	if (!kind || !folderKey) return fail(400, `${target.name} has no Kind (Character, Location or Prop) in Notion`);

	// Notion is the master of the name the code is built from: it is read now, not trusted from the last re-check.
	let pages;
	try { pages = await readReferences(deps.notion, record.references.source); } catch (cause) { return fail(502, `Notion could not be read: ${reason(cause)}. Nothing was linked.`); }
	const page = pages.find((ref) => bareId(ref.page_id) === bareId(target.page_id));
	if (!page) return fail(409, `${target.name} is no longer in Notion's References; re-check the series. Nothing was linked.`);
	if (page.name !== target.name || kindOf(page.kind) !== kind) return fail(409, `${target.name} is ${page.name} (${page.kind || 'no kind'}) in Notion now; re-check the series before linking. Nothing was linked.`);

	let sent: LinkResult['sent'] = null;
	let marked: LinkResult['marked'] = null;
	if (input.asset_id) {
		const references = deps.references!;
		const client = references.client;
		const room = record.review_room;
		if (!room) return fail(409, `${record.title} is not linked to Review Room; run the Review Room sync on the Series page`);
		let found;
		try { found = (await referenceSheets(client, room)).find(({ asset }) => asset.assetId === input.asset_id); } catch (cause) { return fail(502, `Review Room could not be read: ${reason(cause)}. Nothing was linked.`); }
		if (!found) return fail(404, `That sheet is not in ${record.title}'s reference folders in Review Room`);
		const { asset } = found;
		const stray = asset.assetCode ?? asset.title;
		const code = referenceCode(record.show_code, folderKey, target.name);
		// The same refusals "mark as old" makes, checked before the upload so a link never stops half way for them.
		if (found.folder_key !== folderKey) return fail(400, `${stray} is not a ${kind} sheet, so it cannot be ${target.name}'s`);
		if (asset.assetCode === code) return fail(409, `${stray} is already ${target.name}'s sheet`);
		const user = record.references.items.find((ref) => { const folder = referenceFolderKey(ref.kind); return folder && referenceCode(record.show_code, folder, ref.name) === asset.assetCode; });
		if (user) return fail(409, `${stray} is ${user.name}'s sheet in Notion, so it is not linked`);
		const attached = Object.entries(record.reference_files ?? {}).find(([pageId, file]) => file.asset_id === asset.assetId && bareId(pageId) !== bareId(target.page_id));
		if (attached) return fail(409, `${stray} is another reference's picture here, so it is not linked`);
		if (!asset.currentVersionId) return fail(409, `${stray} has no current version in Review Room to send`);

		let bytes: Uint8Array, ext: string | undefined;
		try {
			const media = await client.versionMedia(asset.currentVersionId);
			ext = EXT[media.original.mimeType];
			if (!ext) return fail(409, `${stray} is not a PNG, JPEG or WebP picture, so it cannot be sent as ${target.name}`);
			bytes = await client.download(media.original.url);
		} catch (cause) { return fail(502, `${stray} could not be read from Review Room: ${reason(cause)}. Nothing was linked.`); }

		// Upload first: if it fails or is refused, the stray is left as it was.
		const upload = await uploadReference(references, record.series_id, { page_id: target.page_id, file_name: `${sheetFileName(target.name)}${ext}`, bytes })
			.catch((cause): Failure => fail(502, reason(cause)));
		if (!upload.ok) return fail(upload.status, `${stray} was not sent as ${target.name}: ${reason(upload.message)}. Nothing was marked old.`);
		const file = upload.record.reference_files![target.page_id];
		sent = { code: file.code, version: file.version };

		const old = await markOld({ ...deps, client }, project, { asset_id: asset.assetId, history_of: target.page_id })
			.catch((cause): Failure => fail(502, reason(cause)));
		if (!old.ok) return fail(old.status, `${target.name}'s sheet is in Review Room as ${file.code} (version ${file.version}), but ${stray} was not marked old: ${reason(old.message)}. Mark it old from the check.`);
		marked = { code: old.code };
	}

	if (formerNames.length) {
		try { await addPrepEntry(deps, project.project_id, kind, target.name, target.page_id, formerNames); }
		catch (cause) { return fail(500, `${sent ? `${target.name}'s sheet is in Review Room as ${sent.code}${marked ? ` and ${marked.code} is marked old` : ''}, but ` : ''}${project.title}'s Prep could not be pointed at ${target.name}: ${reason(cause)}`); }
	}
	return { ok: true, page_id: target.page_id, name: target.name, sent, marked };
}
