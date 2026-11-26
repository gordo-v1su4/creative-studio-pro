import { kindOf, sameName, squash, type PrepKind } from './prep';
import type { DriftNotionRef, DriftSheet } from './drift';
import { REFERENCE_FOLDERS, referenceCode } from './series-tree';

/**
 * Where each of a project's Prep references stands (Drift 09, GitHub #37 / V1S-513; ADR 0012), so the operator can
 * see what is left to prep. In Review Room: its Notion reference has a sheet there (or the app sent one). Waiting for
 * a picture: it is in Notion with no sheet yet. Missing from Notion: no Notion reference is it. "Only in this
 * project" counts the names missing from Notion, two spellings of one name once; it falls to zero once the drift
 * is settled.
 */

export type Standing = 'in_review_room' | 'waiting_for_picture' | 'missing_from_notion';
export interface StandingPrepEntry { key: string; kind: PrepKind; name: string; reference_page_id: string | null }
export interface StandingInput {
	show_code: string | undefined;
	notion: DriftNotionRef[];
	/** This project's Prep entries, as Prep lists them. */
	prep: StandingPrepEntry[];
	/** The Review Room reference sheets the check read (none when it could not read them). */
	sheets: DriftSheet[];
	/** Notion page ids the app has sent a sheet for (the series record's reference files). */
	sent: string[];
}
export interface PrepStanding { entries: Array<{ key: string; kind: PrepKind; name: string; standing: Standing }>; only_here: number }

export function prepStanding(input: StandingInput): PrepStanding {
	const notion = input.notion.flatMap((ref) => { const kind = kindOf(ref.kind); return kind ? [{ ...ref, kind }] : []; });
	const sent = new Set(input.sent);
	const sheetCodes = new Set(input.sheets.flatMap((sheet) => (sheet.code ? [`${sheet.folder_key}|${sheet.code}`] : [])));
	const folderOf = (kind: PrepKind) => REFERENCE_FOLDERS.find((folder) => kindOf(folder.kind) === kind)!.key;
	const missing = new Set<string>();
	const entries = input.prep.map(({ key, kind, name, reference_page_id }) => {
		const ref = notion.find((one) => one.page_id === reference_page_id) ?? notion.find((one) => one.kind === kind && sameName(one.name, name));
		let standing: Standing;
		if (!ref) { standing = 'missing_from_notion'; missing.add(`${kind}:${squash(name)}`); }
		else {
			const folder = folderOf(kind);
			standing = sent.has(ref.page_id) || sheetCodes.has(`${folder}|${referenceCode(input.show_code, folder, ref.name)}`) ? 'in_review_room' : 'waiting_for_picture';
		}
		return { key, kind, name, standing };
	});
	return { entries, only_here: missing.size };
}
