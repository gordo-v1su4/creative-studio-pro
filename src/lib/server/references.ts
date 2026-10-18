import type { Project } from '$lib/domain/schemas';
import { compileHandles, type HandleTarget } from '$lib/domain/handles';
import { SeriesStore, type SeriesRecord } from './series';

/**
 * A series episode's references and the handle compile at send time (V1S-327): the card keeps the prompt
 * as written (`@Kai`); quote and send compile it, lint the result against the references' exact names,
 * and list the files to attach. A reference that can't be attached safely blocks the send.
 */
export type SeriesReferenceItem = NonNullable<SeriesRecord['references']>['items'][number];

/** Where a reference's file is on disk for attaching; null = not available (V1S-326 fills this from Review Room). */
export type ReferenceFiles = (reference: SeriesReferenceItem) => Promise<string | null>;
export const noReferenceFiles: ReferenceFiles = async () => null;

export async function seriesReferences(projectRoot: string, project: Project): Promise<SeriesReferenceItem[]> {
	if (!project.series) return [];
	const record = await SeriesStore.beside(projectRoot).read(project.series.series_id).catch(() => null);
	return record?.references?.items ?? [];
}

/** `Kai_Hoodie_Santana_sheet.png` contains `Kai "Hoodie" Santana`: compared on letters and digits only. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const fileNameHasName = (fileName: string, name: string) => Boolean(squash(name)) && squash(fileName).includes(squash(name));

export interface CompiledForSend { prompt: string; files: string[]; blocked: string[]; references: SeriesReferenceItem[] }

/** Compile a prompt's handles, check each used reference (name on sheet, file name, a file to attach). */
export async function compileForSend(prompt: string, references: SeriesReferenceItem[], target: HandleTarget, files: ReferenceFiles = noReferenceFiles): Promise<CompiledForSend> {
	const compiled = compileHandles(prompt, references, target);
	const blocked: string[] = [];
	for (const handle of compiled.ambiguous) blocked.push(`${handle} points at more than one reference; give each reference its own handle`);
	const attach: string[] = [];
	for (const { reference } of compiled.images) {
		if (!reference.name_on_sheet) blocked.push(`Reference "${reference.name}": its name is not printed on the sheet yet (Name on sheet is off)`);
		if (!fileNameHasName(reference.file_name, reference.name)) blocked.push(`Reference "${reference.name}": the file name "${reference.file_name || '(none)'}" does not contain its name`);
		const file = await files(reference);
		if (file) attach.push(file);
		else blocked.push(`Reference "${reference.name}" has no file to attach yet (upload it to the series' _References in Review Room)`);
	}
	return { prompt: compiled.prompt, files: attach, blocked, references };
}
