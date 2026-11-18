import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Capture current working-sheet identities before an offline normalization maintenance window. */
const origin = process.argv[2], root = process.env.CSP_PROJECT_ROOT, token = process.env.CSP_OPERATOR_TOKEN;
if (!origin || !root || !token) throw new Error('Run in the configured runtime and pass its origin URL');
const headers = { 'x-csp-gateway': token };
const catalog = await fetch(new URL('/api/projects', origin), { headers });
if (!catalog.ok) throw new Error(`Project lookup returned ${catalog.status}`);
const projects = (await catalog.json() as { data: Array<{ project_id: string }> }).data;
if (!Array.isArray(projects)) throw new Error('Invalid project catalog');
const directory = join(dirname(root), 'reference-normalization-snapshots');
await mkdir(directory, { recursive: true });
for (const project of projects) {
	if (!/^[a-zA-Z0-9_-]+$/.test(project.project_id)) throw new Error('Invalid project ID');
	const response = await fetch(new URL(`/api/projects/${project.project_id}/prep`, origin), { headers });
	if (!response.ok) throw new Error(`Prep lookup returned ${response.status}`);
	const body = await response.json() as { ok: boolean; data?: { items: Array<{ entry: { key: string; kind: string }; state: { result?: { url: string } | null } }> } };
	if (!body.ok || !body.data) throw new Error('Prep snapshot failed');
	const items = body.data.items.map(item => ({ entry: { key: item.entry.key, kind: item.entry.kind }, state: { result: item.state.result ? { url: item.state.result.url } : null } }));
	await writeFile(join(directory, `${project.project_id}.json`), JSON.stringify({ ok: true, data: { items } }));
	console.log(JSON.stringify({ projectId: project.project_id, entries: items.length }));
}
