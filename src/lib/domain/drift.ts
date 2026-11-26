import { kindOf, sameName, squash, type PrepKind } from './prep';
import type { Project } from './schemas';
import { REFERENCE_FOLDERS, referenceCode } from './series-tree';
import type { PrepStanding } from './drift-standing';
import { MIN_LONG_EDGE } from './media';

/**
 * The drift check's comparison rule (Drift 03, GitHub #32 / V1S-510; spec GitHub #28; ADR 0012). Notion's
 * References are the master of names; each project's Prep and Review Room's reference folders are compared with
 * them, and anything found in one and missing from the others becomes an item with only the choices that make
 * sense for it. A Notion reference with no sheet is not drift. The rule only proposes a link; it never decides one.
 */

export interface DriftNotionRef { page_id: string; name: string; kind: string }
/** One name a project's Prep holds, spelled as it is there (two spellings of one place are two entries). */
export interface DriftPrepEntry {
	project_id: string; project_title: string; kind: PrepKind; name: string; reference_page_id: string | null;
	/** Drift 08: the sheet made in Prep and not yet in Review Room (its size, its Prep URL and Prep key), or null. */
	picture?: { width: number; height: number; url: string; entry_key: string } | null;
}
/** One asset in a Review Room reference folder (`refs:characters`, `refs:locations`, `refs:props`). */
export interface DriftSheet {
	asset_id: string; code: string | null; folder_key: string; title: string;
	/** Marked old (Drift 04): kept as history, never drift. */ old?: boolean;
	/** Drift 06: the Notion page the sheet was sent from, and the name it was sent under, from its metadata. */
	page_id?: string | null; reference_name?: string | null;
}
/** Drift 06: a sheet the app sent for a Notion page (the series record's reference files). */
export interface DriftSent { page_id: string; asset_id: string; code: string; /** The file name it was sent under. */ file_name?: string }
export interface DriftInput { show_code: string | undefined; notion: DriftNotionRef[]; prep: DriftPrepEntry[]; sheets: DriftSheet[]; sent?: DriftSent[] }

/**
 * `restore_name` and `new_reference` answer a rename in Notion (Drift 06). There is no rename choice: a coded
 * reference's name is never changed from the app (ADR 0012).
 */
export const RENAME_CHOICES = ['restore_name', 'new_reference'] as const;
export type RenameChoice = (typeof RENAME_CHOICES)[number];
export type DriftChoice = 'add_to_notion' | 'link' | 'mark_old' | 'upscale' | 'remake' | RenameChoice;
/** Where an item is missing (it is never found in Notion: anything in Notion is in step or is not drift). */
export type DriftPlace = 'notion' | 'review_room';
export interface DriftItem {
	key: string;
	kind: PrepKind;
	type: 'only_in_prep' | 'only_in_review_room' | 'picture_too_small' | 'renamed_in_notion';
	/** The proposed name: straight apostrophes, no " - ". The operator can edit it before it is written. */
	name: string;
	/** Every spelling found, in the order found. */
	spellings: string[];
	found: { prep: Array<{ project_id: string; project_title: string }>; review_room: { asset_id: string; code: string } | null };
	missing: DriftPlace[];
	/** A Notion reference whose name is close (Bryson → Bryson Vane): proposed, never decided. */
	link_to: { page_id: string; name: string } | null;
	choices: DriftChoice[];
	/** Drift 08: a picture under 2048 px on its long edge, where it is in Prep, and its Notion page (null until added). */
	picture?: { width: number; height: number; url: string; entry_key: string; project_id: string; reference_page_id: string | null };
	/** Drift 06: a Notion page renamed after its code was set: the name its sheets carry, Notion's name now, and those sheets. */
	renamed?: { page_id: string; from: string; to: string; sheets: Array<{ asset_id: string; code: string }> };
}

/** What the check returns: the items, and what it read to find them. */
export interface DriftReport {
	series_title: string;
	items: DriftItem[];
	/** Where each of the asking project's Prep references stands, and its "only in this project" count (Drift 09). */
	standing: { project_id: string; review_room_read: boolean } & PrepStanding;
	/** Notion's reference count, the series' projects, the Review Room sheets (null when not read), and projects whose Prep could not be read. */
	read: { notion: number; projects: Array<{ project_id: string; title: string }>; sheets: number | null; skipped: string[] };
	/** Notion's references, for "mark as old" to name the one a sheet is history of (Drift 04). */
	references: Array<{ page_id: string; name: string; kind: PrepKind }>;
}

/** The series a project belongs to: an imported episode's, or the series its story plan was built from. */
export const seriesIdOf = (project: Project) => project.series?.series_id ?? project.production.story_plan?.source?.series_id ?? null;

const KIND_ORDER: Record<PrepKind, number> = { character: 0, location: 1, prop: 2 };
const FOLDER_KIND: Record<string, PrepKind> = { 'refs:characters': 'character', 'refs:locations': 'location', 'refs:props': 'prop' };
const folderOf = (kind: PrepKind) => REFERENCE_FOLDERS.find((folder) => kindOf(folder.kind) === kind)!.key;
const words = (text: string) => text.toLowerCase().replace(/['‘’ʼ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** One name's words start the other's (Bryson and Bryson Vane), without being the same name. */
function nearName(a: string, b: string): boolean {
	const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length);
	return short.length > 0 && short.length < long.length && short.every((word, i) => long[i] === word);
}

/** The name as it would be written to Notion: straight apostrophes, a comma for " - " or " · ", single spaces. */
export function cleanName(name: string): string {
	return name.replace(/[‘’ʼ]/g, "'").replace(/\s+[-–—·•|]\s+/g, ', ').replace(/\s+/g, ' ').trim();
}

/** "what's out of step?", "is anything out of step", "check drift": the operator asking for the check. */
export function isDriftQuestion(text: string): boolean {
	const t = text.toLowerCase().replace(/[’]/g, "'");
	return /\bout of step\b/.test(t) || /\b(check|run)\b.*\bdrift\b|\bdrift check\b|\bwhat'?s? drifted\b/.test(t);
}

/** "BLR_REF_CHR_LUCIAN_VALE" → "Lucian Vale". */
function nameOfCode(code: string): string {
	const slug = code.replace(/^[A-Z]{3}_REF_[A-Z]{3}_/, '');
	return slug.split('_').filter(Boolean).map((word) => word[0] + word.slice(1).toLowerCase()).join(' ');
}

/** The spelling to propose: the one with the fewest capitals ("Campus walkway" over "Campus Walkway"), else the first. */
const proposed = (spellings: string[]) => cleanName(spellings.reduce((best, next) => ((next.match(/\p{Lu}/gu)?.length ?? 0) < (best.match(/\p{Lu}/gu)?.length ?? 0) ? next : best)));

/** The exact name a sheet was sent under: its metadata's name, else its title less the extension, when either gives its code. */
function sentName(showCode: string | undefined, folder: string, sheet: { code: string; reference_name?: string | null; title?: string; file_name?: string } | undefined): string | null {
	if (!sheet) return null;
	for (const name of [sheet.reference_name, sheet.title, sheet.file_name].map((one) => one?.replace(/\.[a-z0-9]+$/i, ''))) {
		if (name && referenceCode(showCode, folder, cleanName(name)) === sheet.code) return cleanName(name);
	}
	return null;
}

export function driftItems(input: DriftInput): DriftItem[] {
	const notion = input.notion.flatMap((ref) => { const kind = kindOf(ref.kind); return kind ? [{ ...ref, kind }] : []; });
	const notionPages = new Set(notion.map((ref) => ref.page_id));
	const codesInUse = new Set(notion.map((ref) => referenceCode(input.show_code, folderOf(ref.kind), ref.name)));
	const linkFor = (kind: PrepKind, name: string) => { const ref = notion.find((entry) => entry.kind === kind && nearName(entry.name, name)); return ref ? { page_id: ref.page_id, name: ref.name } : null; };

	// Prep: every entry with no Notion page, grouped by kind and name (case, spaces and punctuation aside).
	const groups = new Map<string, { kind: PrepKind; spellings: string[]; prep: DriftItem['found']['prep'] }>();
	for (const entry of input.prep) {
		if (entry.reference_page_id && notionPages.has(entry.reference_page_id)) continue;
		if (notion.some((ref) => ref.kind === entry.kind && sameName(ref.name, entry.name))) continue;
		const key = `${entry.kind}:${squash(entry.name)}`;
		const group = groups.get(key) ?? { kind: entry.kind, spellings: [], prep: [] };
		if (!group.spellings.includes(entry.name)) group.spellings.push(entry.name);
		if (!group.prep.some((found) => found.project_id === entry.project_id)) group.prep.push({ project_id: entry.project_id, project_title: entry.project_title });
		groups.set(key, group);
	}

	const sheets = input.sheets.filter((sheet): sheet is DriftSheet & { code: string } => !!sheet.code && !sheet.old && !!FOLDER_KIND[sheet.folder_key] && !codesInUse.has(sheet.code));
	const claimed = new Set<string>();

	// A rename in Notion (Drift 06): a sheet sent from a Notion page whose name now gives another code, while no
	// sheet carries the new code yet. It is never followed; the operator puts the old name back or makes a new reference.
	const renames: DriftItem[] = [];
	const sentFiles = input.sent ?? [];
	const sentBy = new Map(sentFiles.map((file) => [file.asset_id, file.page_id]));
	const liveCodes = new Set(input.sheets.flatMap((sheet) => (sheet.code && !sheet.old ? [sheet.code] : [])));
	const oldAssets = new Set(input.sheets.flatMap((sheet) => (sheet.old ? [sheet.asset_id] : [])));
	for (const ref of notion) {
		const folder = folderOf(ref.kind);
		const code = referenceCode(input.show_code, folder, ref.name);
		if (liveCodes.has(code)) continue;
		const pageSheets = sheets.filter((sheet) => sheet.folder_key === folder && (sheet.page_id ?? sentBy.get(sheet.asset_id)) === ref.page_id);
		// A sheet the app sent that the check did not read (Review Room not read here) still carries the old code.
		const sentOnly = sentFiles.filter((file) => file.page_id === ref.page_id && file.code !== code && !codesInUse.has(file.code) && !oldAssets.has(file.asset_id) && !pageSheets.some((sheet) => sheet.asset_id === file.asset_id));
		const oldCoded = [...pageSheets, ...sentOnly].map(({ asset_id, code: sheetCode }) => ({ asset_id, code: sheetCode }));
		if (!oldCoded.length) continue;
		for (const sheet of oldCoded) claimed.add(sheet.asset_id);
		const from = sentName(input.show_code, folder, pageSheets[0]) ?? sentName(input.show_code, folder, sentFiles.find((file) => file.page_id === ref.page_id && file.code === oldCoded[0].code)) ?? nameOfCode(oldCoded[0].code);
		renames.push({
			key: `renamed:${ref.page_id}`, kind: ref.kind, type: 'renamed_in_notion', name: ref.name, spellings: [from, ref.name],
			found: { prep: [], review_room: oldCoded[0] }, missing: ['review_room'], link_to: null, choices: [...RENAME_CHOICES],
			renamed: { page_id: ref.page_id, from, to: ref.name, sheets: oldCoded }
		});
	}
	const items: DriftItem[] = [...renames, ...[...groups].map(([key, group]) => {
		const codes = new Set(group.spellings.map((spelling) => referenceCode(input.show_code, folderOf(group.kind), spelling)));
		const sheet = sheets.find((entry) => FOLDER_KIND[entry.folder_key] === group.kind && codes.has(entry.code));
		if (sheet) claimed.add(sheet.asset_id);
		const name = proposed(group.spellings);
		const link = linkFor(group.kind, name);
		return {
			key, kind: group.kind, type: 'only_in_prep', name, spellings: group.spellings,
			found: { prep: group.prep, review_room: sheet ? { asset_id: sheet.asset_id, code: sheet.code } : null },
			missing: sheet ? ['notion'] : ['notion', 'review_room'], link_to: link,
			choices: link ? ['add_to_notion', 'link'] : ['add_to_notion']
		} satisfies DriftItem;
	})];

	// Review Room: a sheet whose code no Notion reference (and no Prep entry above) gives.
	for (const sheet of sheets.filter((entry) => !claimed.has(entry.asset_id))) {
		const kind = FOLDER_KIND[sheet.folder_key];
		const title = cleanName(sheet.title);
		const name = referenceCode(input.show_code, sheet.folder_key, title) === sheet.code ? title : nameOfCode(sheet.code);
		const link = linkFor(kind, name);
		items.push({
			key: `sheet:${sheet.code}`, kind, type: 'only_in_review_room', name, spellings: [name],
			found: { prep: [], review_room: { asset_id: sheet.asset_id, code: sheet.code } },
			missing: ['notion'], link_to: link, choices: link ? ['link', 'mark_old'] : ['mark_old']
		});
	}
	// Pictures (Drift 08): a Prep sheet under 2048 px on its long edge is its own item, so adding to Notion never waits on it.
	// A reference whose sheet is already in Review Room (by its code) has no picture to send; an old sheet (Drift 04) is history, not its sheet.
	const sheetCodes = new Set(input.sheets.flatMap((sheet) => (sheet.code && !sheet.old ? [sheet.code] : [])));
	const small = new Set<string>();
	for (const entry of input.prep) {
		const picture = entry.picture;
		if (!picture || Math.max(picture.width, picture.height) >= MIN_LONG_EDGE) continue;
		if (sheetCodes.has(referenceCode(input.show_code, folderOf(entry.kind), entry.name))) continue;
		const key = `picture:${entry.kind}:${squash(entry.name)}`;
		if (small.has(key)) continue;
		small.add(key);
		const page = entry.reference_page_id && notionPages.has(entry.reference_page_id) ? entry.reference_page_id : null;
		items.push({
			key, kind: entry.kind, type: 'picture_too_small', name: entry.name, spellings: [entry.name],
			found: { prep: [{ project_id: entry.project_id, project_title: entry.project_title }], review_room: null },
			missing: ['review_room'], link_to: null, choices: ['upscale', 'remake'],
			picture: { ...picture, project_id: entry.project_id, reference_page_id: page }
		});
	}
	return items.map((item, i) => ({ item, i })).sort((a, b) => KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.i - b.i).map(({ item }) => item);
}

/**
 * Old (Drift 04, GitHub #33 / V1S-511; glossary "Old (reference)"): a sheet no Notion reference uses any more stays
 * in Review Room as history, flagged in its current version's metadata as Review Room custom fields: `old`, and the
 * reference it is history of when there is one. Nothing else in the metadata changes.
 */
const FIELD = { old: 'old', name: 'history_of', page: 'history_of_notion_page_id' } as const;
const OLD_IDS = new Set<string>(Object.values(FIELD));
type CustomField = { id: string; label: string; kind: string; value: unknown };
const fieldsOf = (metadata: Record<string, unknown>): CustomField[] => (Array.isArray(metadata.customFields) ? metadata.customFields as CustomField[] : []);

export function isMarkedOld(metadata: Record<string, unknown>): boolean {
	return fieldsOf(metadata).some((field) => field.id === FIELD.old && field.value === true);
}

/** The metadata with the old flag (and its history) added; earlier old fields are replaced, every other field kept. */
export function markedOld(metadata: Record<string, unknown>, historyOf: { page_id: string; name: string } | null): Record<string, unknown> {
	return {
		...metadata,
		customFields: [
			...fieldsOf(metadata).filter((field) => !OLD_IDS.has(field.id)),
			{ id: FIELD.old, label: 'Old', kind: 'boolean', value: true },
			...(historyOf ? [
				{ id: FIELD.name, label: 'History of', kind: 'text', value: historyOf.name },
				{ id: FIELD.page, label: 'History of (Notion page)', kind: 'text', value: historyOf.page_id }
			] : [])
		]
	};
}

/** The history an old sheet carries, as written by `markedOld`; null when it has none. */
export function historyOf(metadata: Record<string, unknown>): { page_id: string; name: string } | null {
	const fields = fieldsOf(metadata);
	const name = fields.find((field) => field.id === FIELD.name)?.value;
	const page = fields.find((field) => field.id === FIELD.page)?.value;
	return typeof name === 'string' && typeof page === 'string' ? { page_id: page, name } : null;
}
