import { env } from '$env/dynamic/private';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { publicIndexEntrySchema, publicSnapshotSchema, indexEntryOf, type PublicIndexEntry, type PublicSnapshot } from '$lib/domain/publish';

/**
 * Where published snapshots live. Reading: the public site, from a base URL (the public bucket, set by
 * CSP_PUBLISHED_BASE_URL) or, on the operator's machine, from the local `published/` folder beside the
 * projects. Writing: only the studio, into the local folder (and, once its credentials are set, the bucket).
 * Layout either way: index.json, then <slug>/snapshot.json and <slug>/files/<path> for each media file.
 */
export interface PublishedReader {
	index(): Promise<PublicIndexEntry[]>;
	snapshot(slug: string): Promise<PublicSnapshot | null>;
	/** The URL a browser loads one published media file from. */
	mediaUrl(slug: string, file: string): string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const encodePath = (file: string) => file.split('/').map(encodeURIComponent).join('/');
const parseIndex = (value: unknown) => (Array.isArray(value) ? value.flatMap((entry) => { const parsed = publicIndexEntrySchema.safeParse(entry); return parsed.success ? [parsed.data] : []; }) : []);

/** The public bucket (or any static host with the same layout), read over HTTP. */
export class HttpPublishedReader implements PublishedReader {
	private readonly base: string;
	constructor(base: string, private readonly fetcher: typeof fetch = fetch) { this.base = base.replace(/\/+$/, ''); }
	private async json(path: string): Promise<unknown | null> {
		const response = await this.fetcher(`${this.base}/${path}`, { headers: { accept: 'application/json' } });
		if (!response.ok) return null;
		return response.json();
	}
	async index() { return parseIndex(await this.json('index.json').catch(() => null)); }
	async snapshot(slug: string) {
		if (!SLUG.test(slug)) return null;
		const parsed = publicSnapshotSchema.safeParse(await this.json(`${slug}/snapshot.json`).catch(() => null));
		return parsed.success ? parsed.data : null;
	}
	mediaUrl(slug: string, file: string) { return `${this.base}/${slug}/files/${encodePath(file)}`; }
}

/** The local `published/` folder: read by the studio's own /watch preview, written by Publish. */
export class LocalPublishedStore implements PublishedReader {
	constructor(readonly root: string) {}
	static beside(projectRoot: string) { return new LocalPublishedStore(join(dirname(resolve(projectRoot)), 'published')); }
	private async json(path: string): Promise<unknown | null> {
		try { return JSON.parse(await readFile(join(this.root, path), 'utf8')); } catch { return null; }
	}
	async index() { return parseIndex(await this.json('index.json')); }
	async snapshot(slug: string) {
		if (!SLUG.test(slug)) return null;
		const parsed = publicSnapshotSchema.safeParse(await this.json(join(slug, 'snapshot.json')));
		return parsed.success ? parsed.data : null;
	}
	mediaUrl(slug: string, file: string) { return `/api/public/files/${slug}/${encodePath(file)}`; }
	/** The file on disk for a published media path, or null when the path escapes the snapshot's folder. */
	filePath(slug: string, file: string): string | null {
		if (!SLUG.test(slug)) return null;
		const base = resolve(this.root, slug, 'files');
		const target = resolve(base, file);
		return target.startsWith(base + sep) ? target : null;
	}

	/** Publish: copy each media file, write the snapshot, then put it at the top of the index (replacing an older copy). */
	async publish(snapshot: PublicSnapshot, sourceFiles: string): Promise<{ copied: number; missing: string[] }> {
		const missing: string[] = [];
		let copied = 0;
		for (const file of snapshot.files) {
			const from = resolve(sourceFiles, file);
			const to = this.filePath(snapshot.slug, file);
			if (!to || !from.startsWith(resolve(sourceFiles) + sep)) { missing.push(file); continue; }
			try { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); copied += 1; }
			catch { missing.push(file); }
		}
		// A file that could not be copied is left out of the snapshot, so visitors never meet a broken player.
		const gone = new Set(missing);
		const keep = <T extends { file: string }>(media: T | null) => (media && !gone.has(media.file) ? media : null);
		const published: PublicSnapshot = {
			...snapshot,
			beats: snapshot.beats.map((beat) => ({ ...beat, take: keep(beat.take) })),
			cuts: snapshot.cuts.map((cut) => ({ ...cut, film: keep(cut.film), entries: cut.entries.filter((entry) => !gone.has(entry.media.file)) })),
			files: snapshot.files.filter((file) => !gone.has(file))
		};
		await this.writeJson(join(published.slug, 'snapshot.json'), published);
		const index = (await this.index()).filter((entry) => entry.slug !== published.slug);
		await this.writeJson('index.json', [indexEntryOf(published), ...index]);
		return { copied, missing };
	}

	private async writeJson(path: string, value: unknown) {
		const target = join(this.root, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(`${target}.tmp`, JSON.stringify(value, null, '\t'));
		await rename(`${target}.tmp`, target);
	}
}

const NOTHING_PUBLISHED: PublishedReader = { index: async () => [], snapshot: async () => null, mediaUrl: () => '' };

/**
 * The watch pages' source. Kept apart from the studio's config so the public site loads none of the
 * studio's server modules: the public bucket when CSP_PUBLISHED_BASE_URL is set, else the local folder
 * beside CSP_PROJECT_ROOT (the studio's own preview), else nothing published.
 */
export function getPublishedReader(): PublishedReader {
	const base = env.CSP_PUBLISHED_BASE_URL?.trim();
	if (base) return new HttpPublishedReader(base);
	return env.CSP_PROJECT_ROOT ? LocalPublishedStore.beside(env.CSP_PROJECT_ROOT) : NOTHING_PUBLISHED;
}
