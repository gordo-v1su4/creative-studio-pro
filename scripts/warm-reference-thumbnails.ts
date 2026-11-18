import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Run inside the Studio container: warm existing references without changing project state. */
const projectId = process.argv[2];
const origin = process.argv[3];
if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Pass one project ID');
if (!origin || !/^https?:\/\//.test(origin)) throw new Error('Pass the configured origin URL as the second argument');
if (!process.env.CSP_PROJECT_ROOT || !process.env.CSP_OPERATOR_TOKEN) throw new Error('Run in the configured Studio runtime');
const folder = join(process.env.CSP_PROJECT_ROOT, projectId, 'files', 'prep', 'references');
let originalBytes = 0, thumbnailBytes = 0, count = 0;
for (const file of await readdir(folder)) {
	if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
	originalBytes += (await stat(join(folder, file))).size;
	for (const size of ['small', 'medium']) {
		const response = await fetch(new URL(`/api/projects/${projectId}/files/prep/references/${encodeURIComponent(file)}?variant=${size}`, origin), {
			headers: { 'x-csp-gateway': process.env.CSP_OPERATOR_TOKEN }, signal: AbortSignal.timeout(180_000)
		});
		if (!response.ok || !response.headers.get('content-type')?.includes('image/webp')) throw new Error(`Thumbnail warming failed: ${response.status}`);
		const bytes = (await response.arrayBuffer()).byteLength;
		if (size === 'medium') thumbnailBytes += bytes;
	}
	count++;
}
console.log(JSON.stringify({ projectId, count, originalBytes, thumbnailBytes }));
