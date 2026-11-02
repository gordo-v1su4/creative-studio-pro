import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import { runFfmpeg } from './ffmpeg';
import type { ModelImage } from './model-provider';
import type { SeriesReferenceItem } from './references';
import type { SeriesRecord, SeriesStore } from './series';

/**
 * Who might be in a shot, so its caption can say "Kai" instead of "a young man with bleached hair" (the
 * stack-structure approach). The caption gateway takes at most two character headshots per frame, and a short
 * list beats "find these faces among everyone", so each shot gets the characters its own words name: the
 * shot's title, beat, take name and generation prompt. A shot that names nobody gets the project's most
 * named characters. The model may only answer with those names, or `unknown`.
 */
export interface CastMember { name: string; label: string; reference: SeriesReferenceItem }
export interface CastHeadshot { label: string; image: ModelImage }

/** The gateway's limit: two character references (plus one environment, unused here). */
export const MAX_CAST = 2;

const quoted = (name: string) => name.match(/["“”']([^"“”']+)["“”']/)?.[1];
/** A character's short name for captions: "Kai \"Hoodie\" Santana" → "Kai". */
export const castLabel = (reference: SeriesReferenceItem) => reference.name.replace(/["“”][^"“”]*["“”]/g, ' ').trim().split(/\s+/)[0] || reference.name;

/** The words that name this character in a shot's text: handles, first name, nickname and full name. */
function namesOf(reference: SeriesReferenceItem): string[] {
	const plain = reference.name.replace(/["“”][^"“”]*["“”]/g, ' ').replace(/\s+/g, ' ').trim();
	return [...new Set([castLabel(reference), plain, quoted(reference.name), ...reference.handles.map((h) => h.replace(/^@/, ''))].filter((n): n is string => !!n && n.length > 1))];
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where in the text this character is first named, or -1. */
function firstMention(text: string, reference: SeriesReferenceItem): number {
	const hits = namesOf(reference).map((name) => text.search(new RegExp(`(^|[^\\p{L}])@?${escape(name)}(?![\\p{L}])`, 'iu'))).filter((at) => at >= 0);
	return hits.length ? Math.min(...hits) : -1;
}

const characters = (references: SeriesReferenceItem[]) => references.filter((r) => r.kind.toLowerCase() === 'character');

/** How many times the text names this character. */
function mentions(text: string, reference: SeriesReferenceItem): number {
	return namesOf(reference).reduce((sum, name) => sum + (text.match(new RegExp(`(^|[^\\p{L}])@?${escape(name)}(?![\\p{L}])`, 'giu'))?.length ?? 0), 0);
}

/**
 * The characters a shot names: those in its title (the take's name, the shot's title) in title order, then
 * those its prompt and beat name most (a prompt often lists every reference up top, so order there means little).
 * The fallback when it names nobody.
 */
export function castFor(shot: { title: string; body?: string }, references: SeriesReferenceItem[], fallback: SeriesReferenceItem[] = [], max = MAX_CAST): CastMember[] {
	const body = shot.body ?? '';
	const named = characters(references)
		.map((reference) => ({ reference, title: firstMention(shot.title, reference), count: mentions(body, reference), at: firstMention(body, reference) }))
		.filter((m) => m.title >= 0 || m.count > 0)
		.sort((a, b) => (a.title >= 0 ? a.title : Infinity) - (b.title >= 0 ? b.title : Infinity) || b.count - a.count || a.at - b.at)
		.map((m) => m.reference);
	return (named.length ? named : fallback).slice(0, max).map((reference) => ({ name: reference.name, label: castLabel(reference), reference }));
}

/** The project's most named characters across every shot and take, for shots that name nobody. */
export function projectRegulars(project: Project, references: SeriesReferenceItem[], max = MAX_CAST): SeriesReferenceItem[] {
	const texts = [
		...project.production.cards.map((card) => `${card.title} ${card.beat}`),
		...project.production.assets.map((take) => `${take.name} ${take.generation?.prompt ?? ''}`)
	];
	return characters(references)
		.map((reference) => ({ reference, count: texts.filter((text) => firstMention(text, reference) >= 0).length }))
		.filter((m) => m.count > 0)
		.sort((a, b) => b.count - a.count)
		.slice(0, max)
		.map((m) => m.reference);
}

/** The series this project draws its cast from: its episode's series, else the series its title starts with ("Blood Rush — Teaser Trailer"). */
export async function castSeries(store: Pick<SeriesStore, 'list' | 'read'>, project: Project): Promise<SeriesRecord | null> {
	if (project.series) return store.read(project.series.series_id).catch(() => null);
	const title = project.title.toLowerCase();
	const matches = (await store.list().catch(() => [])).filter((record) => record.title && title.startsWith(record.title.toLowerCase()));
	return matches.sort((a, b) => b.title.length - a.title.length)[0] ?? null;
}

/** A reference sheet's file on disk: the local cache first, then whatever resolver can fetch it. */
export function sheetFiles(record: SeriesRecord, cacheDir: string, fetchFile?: (reference: SeriesReferenceItem) => Promise<string | null>) {
	return async (reference: SeriesReferenceItem): Promise<string | null> => {
		const file = record.reference_files?.[reference.page_id];
		if (file) {
			const cached = join(cacheDir, `${file.version_id}${extname(file.file_name).toLowerCase() || '.png'}`);
			if (await stat(cached).then(() => true, () => false)) return cached;
		}
		return fetchFile ? fetchFile(reference).catch(() => null) : null;
	};
}

/** The headshot of a 16:9 character sheet: its first panel (the left third), as a 512px JPEG. A non-sheet image is used whole. */
export async function headshotOf(sheet: string): Promise<ModelImage | null> {
	const dir = await mkdtemp(join(tmpdir(), 'csp-headshot-'));
	const out = join(dir, 'headshot.jpg');
	try {
		await runFfmpeg(['-y', '-i', sheet, '-frames:v', '1', '-vf', "crop='if(gt(iw/ih,1.5),iw/3,iw)':ih:0:0,scale=512:512:force_original_aspect_ratio=decrease", '-q:v', '3', out], 60_000);
		return { data: new Uint8Array(await readFile(out)), mediaType: 'image/jpeg' };
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * The caption's people as the fixed vocabulary: a cast member's label when the model named them (by label or
 * full name), `unknown` for anyone else it saw. Evidence the model marked uncertain doesn't name anyone.
 */
export function namedSubjects(meta: Record<string, unknown>, cast: CastMember[]): string[] {
	const evidence = (meta.evidence as { subjects?: Array<{ name?: unknown; confidence?: unknown }> } | null | undefined)?.subjects ?? [];
	const said = [
		...(Array.isArray(meta.subjects) ? meta.subjects : typeof meta.subjects === 'string' ? meta.subjects.split(/,|;/) : []),
		...evidence.filter((s) => s.confidence !== 'uncertain').map((s) => s.name)
	].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
	const out = said.map((name) => cast.find((member) => namesOf(member.reference).some((n) => n.toLowerCase() === name.toLowerCase()) || member.name.toLowerCase() === name.toLowerCase())?.label ?? 'unknown');
	const named = [...new Set(out.filter((n) => n !== 'unknown'))];
	return out.includes('unknown') ? [...named, 'unknown'] : named;
}
