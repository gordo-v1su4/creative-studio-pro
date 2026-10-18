import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
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
	client: ReviewRoomClient;
	store: SeriesStore;
	/** Where cached copies live (beside the series records, never inside a project). */
	cacheDir: string;
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

/** Upload one vetted reference image; refused when its file name lacks the exact name or it is under 2K. */
export async function uploadReference(deps: ReferenceFileDeps, seriesId: string, input: { page_id: string; file_name: string; bytes: Uint8Array }): Promise<{ ok: true; record: SeriesRecord } | Failure> {
	const record = await deps.store.read(seriesId);
	if (!record) return fail(404, 'Series not found');
	const reference = record.references?.items.find((item) => item.page_id === input.page_id);
	if (!reference) return fail(404, 'That reference is not in the series (re-check the series after adding it in Notion)');
	const type = IMAGE_TYPES[extname(input.file_name).toLowerCase()];
	if (!type) return fail(400, 'A reference is a PNG, JPEG or WebP image');
	if (!fileNameHasName(input.file_name, reference.name)) return fail(400, `The file name "${input.file_name}" must contain the reference's exact name, "${reference.name}"`);
	const folderKey = referenceFolderKey(reference.kind);
	if (!folderKey) return fail(400, `Reference "${reference.name}" has no Kind (Character, Location or Prop) in Notion`);
	const folderId = record.review_room?.folders[folderKey];
	if (!record.review_room || !folderId) return fail(409, 'The series has no _References folders in Review Room yet: run the Review Room sync on the Series page first');

	await mkdir(deps.cacheDir, { recursive: true });
	const staged = join(deps.cacheDir, `upload-${input.page_id}${extname(input.file_name).toLowerCase()}`);
	await writeFile(staged, input.bytes);
	const probed = await deps.probe(staged);
	if (!probed.width || !probed.height) return fail(400, 'Could not read the image size');
	if (Math.max(probed.width, probed.height) < MIN_LONG_EDGE) return fail(400, `The image is ${probed.width}×${probed.height}; references must be at least ${MIN_LONG_EDGE} px on the long edge`);
	const posterFile = `${staged}.poster.jpg`;
	await deps.poster(staged, posterFile);

	const code = referenceCode(record.show_code, folderKey, reference.name);
	const uploaded = await uploadTake(deps.client, {
		projectId: record.review_room.project_id, folderId, assetCode: code, name: input.file_name, type,
		bytes: input.bytes, poster: new Uint8Array(await readFile(posterFile)), durationSec: 0, width: probed.width, height: probed.height,
		metadata: { reference: reference.name, kind: reference.kind, notion_page_id: reference.page_id, handles: reference.handles }, makeCurrent: true
	});
	// The staged upload becomes the cache entry for this version, so the first send needs no download.
	await writeFile(join(deps.cacheDir, `${uploaded.versionId}${extname(input.file_name).toLowerCase()}`), input.bytes);
	const fresh = (await deps.store.read(seriesId)) ?? record;
	const saved = await deps.store.write({
		...fresh,
		reference_files: {
			...(fresh.reference_files ?? {}),
			[reference.page_id]: { asset_id: uploaded.assetId, version_id: uploaded.versionId, version: uploaded.version, code, file_name: input.file_name, mime_type: type, width: probed.width, height: probed.height, uploaded_at: new Date().toISOString() }
		}
	});
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
export function reviewRoomReferenceFiles(deps: Pick<ReferenceFileDeps, 'client' | 'cacheDir' | 'store'>): ReferenceFiles {
	return async (reference: SeriesReferenceItem) => {
		for (const record of await deps.store.list()) {
			const file = record.reference_files?.[reference.page_id];
			if (file) return cachedReference(deps, file).catch(() => null);
		}
		return null;
	};
}
