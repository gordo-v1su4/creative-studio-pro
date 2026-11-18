import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { normalizeReferenceSheet } from '../src/lib/server/reference-sheet';
import { probeMedia } from '../src/lib/server/media-probe';

/** Normalize this project's current working sheets; retain imported versions and immutable backups. */
const [projectId, origin, snapshotPath] = process.argv.slice(2);
if (!projectId || !/^[a-zA-Z0-9_-]+$/.test(projectId) || !origin || !/^https?:\/\//.test(origin)) throw new Error('Pass project ID and configured origin URL');
const root = process.env.CSP_PROJECT_ROOT, token = process.env.CSP_OPERATOR_TOKEN;
if (!root || !token) throw new Error('Run inside the configured Studio container');
const response = snapshotPath ? null : await fetch(new URL(`/api/projects/${projectId}/prep`, origin), { headers: { 'x-csp-gateway': token } });
if (response && !response.ok) throw new Error(`Prep lookup returned ${response.status}`);
const body = (snapshotPath ? JSON.parse(await readFile(snapshotPath, 'utf8')) : await response!.json()) as { ok: boolean; data?: { items: Array<{ entry: { key: string; kind: string }; state: { result?: { url: string } | null } }> } };
if (!body.ok || !body.data) throw new Error('Prep lookup failed');
const projectDir = join(root, projectId), prepPath = join(projectDir, 'prep.json');
let changed = 0, checked = 0, savedPrepBackup = false;
for (const item of body.data.items) {
	if (!['character', 'location'].includes(item.entry.kind) || !item.state.result) continue;
	const url = new URL(item.state.result.url, origin);
	const prefix = `/api/projects/${projectId}/files/prep/references/`;
	if (!url.pathname.startsWith(prefix)) throw new Error('Refusing another project’s sheet');
	const filename = decodeURIComponent(url.pathname.slice(prefix.length));
	if (filename !== basename(filename)) throw new Error('Invalid reference filename');
	const input = join(projectDir, 'files', 'prep', 'references', filename);
	const dimensions = await probeMedia(input);
	if (!dimensions.width || !dimensions.height) throw new Error('Cannot inspect working sheet');
	checked++;
	if (extname(input).toLowerCase() === '.png' && Math.max(dimensions.width, dimensions.height) <= 2048) continue;
	const saved = await readFile(prepPath, 'utf8');
	const prep = JSON.parse(saved);
	const result = prep.entries[item.entry.key]?.result;
	if (!result) throw new Error('Reference selection changed');
	const bytes = await readFile(input);
	const digest = createHash('sha256').update(bytes).digest('hex');
	const originals = join(projectDir, 'files', 'prep', 'originals');
	await mkdir(originals, { recursive: true });
	if (!savedPrepBackup) {
		await copyFile(prepPath, join(originals, `prep-before-2k-${createHash('sha256').update(saved).digest('hex')}.json`));
		savedPrepBackup = true;
	}
	const backup = join(originals, `${digest}${extname(input)}`);
	await copyFile(input, backup);
	if (createHash('sha256').update(await readFile(backup)).digest('hex') !== digest) throw new Error('Original backup did not verify');
	const output = join(projectDir, 'files', 'prep', 'references', `${basename(input, extname(input))}.png`);
	if (!resolve(output).startsWith(resolve(projectDir) + sep)) throw new Error('Invalid output path');
	await normalizeReferenceSheet(input, output);
	const after = await probeMedia(output);
	if (!after.width || !after.height || Math.max(after.width, after.height) > 2048) throw new Error('Working sheet exceeds 2K');
	if (await readFile(prepPath, 'utf8') !== saved) throw new Error('Prep changed during normalization; refusing to overwrite it');
	result.file = relative(projectDir, output).split(sep).join('/');
	result.url = prefix + encodeURIComponent(basename(output));
	result.made_at = new Date().toISOString();
	await writeFile(prepPath, JSON.stringify(prep, null, 2));
	changed++;
}
console.log(JSON.stringify({ projectId, checked, normalized: changed, maxLongEdge: 2048, format: 'png' }));
