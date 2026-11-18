import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReferenceVariantCache } from '../../src/lib/server/reference-variants';
import { referenceImageUrl } from '../../src/lib/media/reference-images';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'studio-variants-')); roots.push(root);
	const file = join(root, 'Mara.png');
	await writeFile(file, 'full resolution original');
	const uploads: FormData[] = [], downloads: string[] = [];
	let fail = false;
	const call = (async (url: string | URL | Request, init?: RequestInit) => {
		if (String(url).endsWith('/process-image')) {
			if (fail) return new Response('private service error', { status: 503 });
			const form = init!.body as FormData;
			uploads.push(form);
			const folder = String(form.get('folder')), name = String(form.get('basename'));
			return Response.json({ storagePath: `${folder}/original/${name}.png`, previewStoragePath: `${folder}/preview/${name}-preview.png`, derivativeStoragePaths: {
				small: `${folder}/low/${name}-w320.webp`, medium: `${folder}/high/${name}-w1280.webp`, large: `${folder}/high/${name}-w1920.webp`
			} });
		}
		downloads.push(String(url));
		return new Response('small webp bytes', { headers: { 'content-type': 'image/webp' } });
	}) as typeof fetch;
	const config = { url: 'https://media.test', token: 'private-token', bucket: 'creative-studio-pro' };
	return { file, root, uploads, downloads, call, config, cache: new ReferenceVariantCache(config, join(root, 'cache'), call), fail: () => { fail = true; } };
}

test('one import stores original, preview and all three variants in the existing gateway layout', async () => {
	const f = await fixture();
	const manifest = await f.cache.prepare(f.file);
	expect(f.uploads).toHaveLength(1);
	expect(f.uploads[0].get('bucket')).toBe('creative-studio-pro');
	expect(await (f.uploads[0].get('file') as File).text()).toBe('full resolution original');
	expect(manifest.original).toMatch(/^media-uploads\/\d{4}\/\d{2}_\d{2}\/[a-f0-9]{64}\/original\/Mara.png$/);
	expect(manifest.variants.small).toContain('/low/Mara-w320.webp');
	expect(manifest.variants.medium).toContain('/high/Mara-w1280.webp');
	expect(manifest.variants.large).toContain('/high/Mara-w1920.webp');
	expect(await readFile(f.file, 'utf8')).toBe('full resolution original');
});

test('concurrent drawer and Prep reads share processing and cache bytes across restart', async () => {
	const f = await fixture();
	const bytes = await Promise.all(Array.from({ length: 8 }, () => f.cache.read(f.file, 'medium')));
	expect(f.uploads).toHaveLength(1);
	expect(f.downloads).toHaveLength(1);
	expect(bytes.every((body) => body.toString() === 'small webp bytes')).toBe(true);
	const restarted = new ReferenceVariantCache(f.config, join(f.root, 'cache'), f.call);
	await restarted.read(f.file, 'medium');
	expect(f.uploads).toHaveLength(1);
	expect(f.downloads).toHaveLength(1);
});

test('replacing a sheet invalidates both manifest and derivative bytes', async () => {
	const f = await fixture();
	const first = await f.cache.prepare(f.file);
	await f.cache.read(f.file, 'small');
	await writeFile(f.file, 'a different replacement sheet');
	const second = await f.cache.prepare(f.file);
	await f.cache.read(f.file, 'small');
	expect(second.digest).not.toBe(first.digest);
	expect(f.uploads).toHaveLength(2);
	expect(f.downloads).toHaveLength(2);
});

test('failed processing remains retryable and preserves source bytes', async () => {
	const f = await fixture(); f.fail();
	await expect(f.cache.prepare(f.file)).rejects.toThrow('503');
	await expect(f.cache.prepare(f.file)).rejects.toThrow('503');
	expect(await readFile(f.file, 'utf8')).toBe('full resolution original');
});

test('thumbnail URLs preserve version identity and full-size preview URLs', () => {
	const original = '/api/projects/id/files/prep/references/Mara.png?v=new-sheet';
	expect(referenceImageUrl(original)).toBe(original + '&variant=medium');
	expect(referenceImageUrl('/api/series/id/references?page_id=mara&v=version', 'small')).toContain('&variant=small');
	expect(referenceImageUrl('https://external.test/reference.png')).toBe('https://external.test/reference.png');
	expect(referenceImageUrl('blob:local')).toBe('blob:local');
	expect(original).not.toContain('variant=');
});
