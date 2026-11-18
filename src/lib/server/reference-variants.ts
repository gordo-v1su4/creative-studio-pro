import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { ReferenceImageSize } from '../media/reference-images';

export interface ReferenceVariantConfig { url: string; token: string; bucket: string }
interface Manifest {
	size: number; mtime: number; digest: string; bucket: string; original: string;
	preview: string; variants: Record<ReferenceImageSize, string>;
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Disposable local cache; originals and all renditions are stored by the existing RustFS Sharp service. */
export class ReferenceVariantCache {
	private preparing = new Map<string, Promise<Manifest>>();
	private reading = new Map<string, Promise<Buffer>>();
	private queue = Promise.resolve();
	constructor(private config: ReferenceVariantConfig, private cacheDir: string, private call: typeof fetch = fetch) {}

	private async atomic(path: string, bytes: string | Uint8Array) {
		await mkdir(this.cacheDir, { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		await writeFile(temporary, bytes);
		await rename(temporary, path);
	}

	prepare(file: string): Promise<Manifest> {
		const key = resolve(file);
		const pending = this.preparing.get(key);
		if (pending) return pending;
		// One conversion at a time avoids flooding the shared service during an old-project backfill.
		const job = this.queue.then(() => this.build(key));
		this.queue = job.then(() => {}, () => {});
		this.preparing.set(key, job);
		void job.finally(() => this.preparing.delete(key)).catch(() => {});
		return job;
	}

	private async build(file: string): Promise<Manifest> {
		const source = await stat(file);
		const manifestPath = join(this.cacheDir, `${hash(file)}.json`);
		const cached: Manifest | null = await readFile(manifestPath, 'utf8').then((text) => JSON.parse(text), () => null).catch(() => null);
		if (cached?.size === source.size && cached.mtime === source.mtimeMs && cached.bucket === this.config.bucket) return cached;
		const extension = extname(file).toLowerCase();
		const type = types[extension];
		if (!type) throw new Error('Unsupported reference image');
		const bytes = await readFile(file);
		const digest = hash(bytes);
		const date = source.mtime.toISOString();
		const folder = `media-uploads/${date.slice(0, 4)}/${date.slice(5, 10).replace('-', '_')}/${digest}`;
		const name = basename(file, extension).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'reference';
		const form = new FormData();
		for (const [field, value] of Object.entries({ userId: 'creative-studio-pro', folder, basename: name, originalExt: extension.slice(1), bucket: this.config.bucket })) form.set(field, value);
		form.set('file', new Blob([bytes], { type }), `${name}${extension}`);
		const response = await this.call(`${this.config.url.replace(/\/$/, '')}/process-image`, {
			method: 'POST', headers: { authorization: `Bearer ${this.config.token}` }, body: form, signal: AbortSignal.timeout(120_000)
		});
		if (!response.ok) throw new Error(`Reference variant service returned ${response.status}`);
		const result = await response.json() as { storagePath: string; previewStoragePath: string; derivativeStoragePaths: Record<ReferenceImageSize, string> };
		const paths = [result.storagePath, result.previewStoragePath, ...(['small', 'medium', 'large'] as const).map((size) => result.derivativeStoragePaths?.[size])];
		if (paths.some((path) => typeof path !== 'string' || !path.startsWith(`${folder}/`) || path.includes('..'))) throw new Error('Reference variant service returned invalid storage paths');
		// Do not publish a manifest for a source replaced while processing.
		const after = await stat(file);
		if (after.size !== source.size || after.mtimeMs !== source.mtimeMs) throw new Error('Reference changed while preparing thumbnails');
		const manifest: Manifest = { size: source.size, mtime: source.mtimeMs, digest, bucket: this.config.bucket, original: result.storagePath, preview: result.previewStoragePath, variants: result.derivativeStoragePaths };
		await this.atomic(manifestPath, JSON.stringify(manifest));
		return manifest;
	}

	async read(file: string, size: ReferenceImageSize): Promise<Buffer> {
		const manifest = await this.prepare(file);
		const key = `${manifest.digest}-${size}`;
		const pending = this.reading.get(key);
		if (pending) return pending;
		const job = (async () => {
			const cached = join(this.cacheDir, `${key}.webp`);
			const bytes = await readFile(cached).catch(() => null);
			if (bytes) return bytes;
			const path = manifest.variants[size].split('/').map(encodeURIComponent).join('/');
			const response = await this.call(`${this.config.url.replace(/\/$/, '')}/files/${encodeURIComponent(manifest.bucket)}/${path}`, { signal: AbortSignal.timeout(30_000) });
			if (!response.ok) throw new Error(`Reference thumbnail download returned ${response.status}`);
			const body = Buffer.from(await response.arrayBuffer());
			await this.atomic(cached, body);
			return body;
		})();
		this.reading.set(key, job);
		void job.finally(() => this.reading.delete(key)).catch(() => {});
		return job;
	}
}

export function referenceImageSize(value: string | null): ReferenceImageSize | null {
	return value === 'small' || value === 'medium' || value === 'large' ? value : null;
}
