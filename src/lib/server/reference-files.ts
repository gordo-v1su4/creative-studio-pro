import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MIN_LONG_EDGE } from '$lib/domain/media';
import { referenceFolderKey } from '$lib/domain/series-tree';
import type { MediaProbe } from './media-probe';
import { fileNameHasName, type ReferenceFiles, type SeriesReferenceItem } from './references';
import { uploadTake, type ReviewRoomClient } from './review-room';
import type { SeriesRecord, SeriesStore } from './series';

/**
 * Reference images in Review Room (V1S-326, ADR 0001: no local master). The operator uploads each vetted
 * image to the series' `_References/<Kind>` folder; the app keeps only a cache of it for attaching to a send
 * and for thumbnails. Nothing is copied from anywhere unless the operator uploads it.
 */

export interface ReferenceFileDeps {
	prepareReference?: (file: string) => Promise<void>;
	normalizeSheet?: (file: string, output: string) => Promise<string>;
	client: ReviewRoomClient;
	store: SeriesStore;
	/** Where cached copies live (beside the series records, never inside a project). */
	cacheDir: string;
	/** Drift 07 (V1S-509): where a sheet's full-size file is kept when Review Room gets its 2K (not a cache). */
	sourceDir: string;
	probe: (file: string) => Promise<MediaProbe>;
	/** Writes a JPEG poster of the image at `input` to `output`. */
	poster: (input: string, output: string) => Promise<void>;
}

type Failure = { ok: false; status: number; message: string };
const fail = (status: number, message: string): Failure => ({ ok: false, status, message });

const KIND_CODE: Record<string, string> = { 'refs:characters': 'CHR', 'refs:locations': 'LOC', 'refs:props': 'PRP' };
/** `BLR_REF_CHR_KAI_HOODIE_SANTANA`: the reference's asset code in Review Room (stable, so a new upload is its next version). */
export function referenceCode(showCode: string | undefined, folderKey: string, name: string): string {
	const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'UNNAMED';
	return `${showCode ?? 'SER'}_REF_${KIND_CODE[folderKey] ?? 'REF'}_${slug}`;
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

type ReferenceFile = NonNullable<SeriesRecord['reference_files']>[string];
/** The kept full-size file of a reference sent at 2K (ADR 0012), or null when the sheet was sent as it was. */
export function referenceSourcePath(sourceDir: string, file: ReferenceFile): string | null {
	return file.source_image ? join(sourceDir, file.source_image.folder, file.source_image.file_name) : null;
}

/**
 * Upload one vetted reference image; refused when its file name lacks the exact name or it is under 2K.
 * A character or location sheet larger than 2K goes up as its 2K PNG and the full-size file is kept as the
 * reference's source image (Drift 07, ADR 0012). `full_size` is the file a sheet already scaled by Prep was made
 * from. A PNG already at 2K is sent unchanged. Nothing is ever scaled up.
 */
export async function uploadReference(deps: ReferenceFileDeps, seriesId: string, input: { page_id: string; file_name: string; bytes: Uint8Array; full_size?: string }): Promise<{ ok: true; record: SeriesRecord } | Failure> {
	const record = await deps.store.read(seriesId);
	if (!record) return fail(404, 'Series not found');
	const reference = record.references?.items.find((item) => item.page_id === input.page_id);
	if (!reference) return fail(404, 'That reference is not in the series (re-check the series after adding it in Notion)');
	let type = IMAGE_TYPES[extname(input.file_name).toLowerCase()];
	if (!type) return fail(400, 'A reference is a PNG, JPEG or WebP image');
	if (!fileNameHasName(input.file_name, reference.name)) return fail(400, `The file name "${input.file_name}" must contain the reference's exact name, "${reference.name}"`);
	const folderKey = referenceFolderKey(reference.kind);
	if (!folderKey) return fail(400, `Reference "${reference.name}" has no Kind (Character, Location or Prop) in Notion`);
	const folderId = record.review_room?.folders[folderKey];
	if (!record.review_room || !folderId) return fail(409, 'The series has no _References folders in Review Room yet: run the Review Room sync on the Series page first');

	await mkdir(deps.cacheDir, { recursive: true });
	let staged = join(deps.cacheDir, `upload-${input.page_id}${extname(input.file_name).toLowerCase()}`);
	await writeFile(staged, input.bytes);
	const size = async (file: string) => { const probe = await deps.probe(file); return { width: probe.width ?? 0, height: probe.height ?? 0 }; };
	const asSent = await size(staged);
	const original = input.full_size
		? { path: input.full_size, file_name: basename(input.full_size), mime_type: IMAGE_TYPES[extname(input.full_size).toLowerCase()] ?? type, ...await size(input.full_size).catch(() => ({ width: 0, height: 0 })) }
		: { path: staged, file_name: input.file_name, mime_type: type, ...asSent };
	const alreadyTwoK = type === 'image/png' && asSent.width > 0 && asSent.height > 0 && Math.max(asSent.width, asSent.height) <= MIN_LONG_EDGE;
	let probed = asSent;
	if (deps.normalizeSheet && (folderKey === 'refs:characters' || folderKey === 'refs:locations') && !alreadyTwoK) {
		staged = await deps.normalizeSheet(staged, `${staged}.2k.png`);
		input = { ...input, file_name: input.file_name.replace(/\.[^.]+$/, '.png'), bytes: new Uint8Array(await readFile(staged)) };
		type = 'image/png';
		probed = await size(staged);
	}
	if (!probed.width || !probed.height) return fail(400, 'Could not read the image size');
	if (Math.max(probed.width, probed.height) < MIN_LONG_EDGE) return fail(400, `The image is ${probed.width}×${probed.height}; references must be at least ${MIN_LONG_EDGE} px on the long edge`);
	// Kept only when Review Room gets a smaller copy than the operator's file (ADR 0012: Pindeck keeps its originals).
	const keep = original.width > 0 && original.height > 0 && Math.max(original.width, original.height) > Math.max(probed.width, probed.height);
	// Copied before the upload, so a failed copy never leaves a Review Room version the record does not know.
	const sourceImage = keep ? { folder: join(input.page_id, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`), file_name: original.file_name, mime_type: original.mime_type, width: original.width, height: original.height } : undefined;
	if (sourceImage) {
		await mkdir(join(deps.sourceDir, sourceImage.folder), { recursive: true });
		await copyFile(original.path, join(deps.sourceDir, sourceImage.folder, sourceImage.file_name));
	}
	const posterFile = `${staged}.poster.jpg`;
	await deps.poster(staged, posterFile);

	const code = referenceCode(record.show_code, folderKey, reference.name);
	const uploaded = await uploadTake(deps.client, {
		projectId: record.review_room.project_id, folderId, assetCode: code, name: input.file_name, type,
		bytes: input.bytes, poster: new Uint8Array(await readFile(posterFile)), durationSec: 0, width: probed.width, height: probed.height,
		metadata: { reference: reference.name, kind: reference.kind, notion_page_id: reference.page_id, handles: reference.handles }, makeCurrent: true
	});
	// The staged upload becomes the cache entry for this version, so the first send needs no download.
	const cached = join(deps.cacheDir, `${uploaded.versionId}${extname(input.file_name).toLowerCase()}`);
	await writeFile(cached, input.bytes);
	await deps.prepareReference?.(cached);
	const file: ReferenceFile = { asset_id: uploaded.assetId, version_id: uploaded.versionId, version: uploaded.version, code, file_name: input.file_name, mime_type: type, width: probed.width, height: probed.height, uploaded_at: new Date().toISOString(), ...(sourceImage ? { source_image: sourceImage } : {}) };
	// V1S-518: saved onto the record as it is now, so a re-check or another write during the upload is kept.
	const saved = await deps.store.upsert(seriesId, (current) => ({ ...(current ?? record), reference_files: { ...((current ?? record).reference_files ?? {}), [reference.page_id]: file } }));
	return { ok: true, record: saved };
}

/** A cached copy of a reference's current image, downloaded from Review Room on first use. */
export async function cachedReference(deps: Pick<ReferenceFileDeps, 'client' | 'cacheDir'>, file: NonNullable<SeriesRecord['reference_files']>[string]): Promise<string> {
	const ext = extname(file.file_name).toLowerCase() || '.png';
	const path = join(deps.cacheDir, `${file.version_id}${ext}`);
	if (await stat(path).then(() => true, () => false)) return path;
	const media = await deps.client.versionMedia(file.version_id);
	await mkdir(deps.cacheDir, { recursive: true });
	await writeFile(path, await deps.client.download(media.original.url));
	return path;
}

/** The send's resolver: a reference's file to attach, from whichever series holds it. */
export async function referenceWorkingCopy(path: string, kind: string, file: { width: number; height: number; mime_type: string }, normalize?: ReferenceFileDeps['normalizeSheet']): Promise<string> {
	const folder = referenceFolderKey(kind);
	if (!normalize || (folder !== 'refs:characters' && folder !== 'refs:locations') || (file.mime_type === 'image/png' && Math.max(file.width, file.height) <= 2048)) return path;
	const output = `${path}.2k.png`;
	if (!await stat(output).then(() => true, () => false)) await normalize(path, output);
	return output;
}

export function reviewRoomReferenceFiles(deps: Pick<ReferenceFileDeps, 'client' | 'cacheDir' | 'store'> & Partial<Pick<ReferenceFileDeps, 'normalizeSheet'>>): ReferenceFiles {
	return async (reference: SeriesReferenceItem) => {
		for (const record of await deps.store.list()) {
			const file = record.reference_files?.[reference.page_id];
			if (file) return cachedReference(deps, file).then(path => referenceWorkingCopy(path, reference.kind, file, deps.normalizeSheet)).catch(() => null);
		}
		return null;
	};
}
