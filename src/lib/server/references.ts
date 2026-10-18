import { join, resolve, sep } from 'node:path';
import type { Project, StoryCard } from '$lib/domain/schemas';
import { previousFrameOf, seriesReferenceIds } from '$lib/domain/shot-references';
import { compileHandles, type HandleTarget } from '$lib/domain/handles';
import { MIN_LONG_EDGE } from '$lib/domain/media';
import { SeriesStore, type SeriesRecord } from './series';

/** How the previous shot's last frame is declared (V1S-328); always after the references. */
export const PREVIOUS_FRAME = 'the last frame of the previous shot — continuity reference';

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

/** What one shot (or a grid's shots) attached by hand: series references by page id, the previous shot's last frame. */
export interface ShotAttachments { series?: string[]; previousFrame?: { file: string; width?: number; height?: number } | null }

/** Compile a prompt's handles, check each used reference (name on sheet, file name, a file to attach). */
export async function compileForSend(prompt: string, references: SeriesReferenceItem[], target: HandleTarget, files: ReferenceFiles = noReferenceFiles, shot: ShotAttachments = {}): Promise<CompiledForSend> {
	const include = (shot.series ?? []).map((id) => references.find((reference) => reference.page_id === id)).filter((reference): reference is SeriesReferenceItem => Boolean(reference));
	const previous = shot.previousFrame ?? null;
	const compiled = compileHandles(prompt, references, target, { include, extras: previous ? [PREVIOUS_FRAME] : [] });
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
	for (const id of shot.series ?? []) if (!include.some((reference) => reference.page_id === id)) blocked.push('A reference attached to the shot is no longer in the series (re-sync, or remove its chip)');
	if (previous) {
		attach.push(previous.file);
		if (!previous.width || !previous.height) blocked.push("The previous shot's frame has no known size; it must be checked against 2K first");
		else if (Math.max(previous.width, previous.height) < MIN_LONG_EDGE) blocked.push(`The previous shot's frame is ${previous.width}×${previous.height}, under ${MIN_LONG_EDGE} px on the long edge`);
	}
	return { prompt: compiled.prompt, files: attach, blocked, references };
}

/** A shot's hand-attached references as the compile needs them; the previous frame's project URL becomes its path. */
export function shotAttachments(projectRoot: string, project: Project, card: StoryCard): ShotAttachments {
	const frame = previousFrameOf(card);
	const prefix = `/api/projects/${project.project_id}/files/`;
	const files = resolve(join(projectRoot, project.project_id, 'files'));
	const path = frame?.url.startsWith(prefix) ? resolve(join(files, decodeURIComponent(frame.url.slice(prefix.length)))) : null;
	return {
		series: seriesReferenceIds(card),
		previousFrame: frame && path && path.startsWith(files + sep) ? { file: path, width: frame.width, height: frame.height } : null
	};
}
