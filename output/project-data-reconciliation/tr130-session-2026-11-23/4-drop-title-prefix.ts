// TR130 step 4 (Robert, 2026-11-23: shots read "MRN_0020 · The rumour moves", not "TR130-02-02 · …"):
// strip the "TR130-SS-NN · " prefix from the 56 shot titles. Shot codes live in review_room.shots and never change;
// nothing else in the project is touched. Same save the app's "Save workspace" makes.
// bun --env-file=.env.local output/project-data-reconciliation/tr130-session-2026-11-23/4-drop-title-prefix.ts [--dry]
const DRY = process.argv.includes('--dry');
const base = 'https://studio-origin.v1su4.dev', id = '01a2067a-6cdc-7d1f-b28c-19429297cb80';
const headers = { 'x-csp-gateway': process.env.CSP_OPERATOR_TOKEN!, origin: base };
const r = await fetch(`${base}/api/projects/${id}`, { headers, redirect: 'error' });
const project = (await r.json()).project;
const PREFIX = /^TR130-\d{2}-\d{2} · /;
let changed = 0;
const cards = project.production.cards.map((card: { title: string }) => {
	if (!PREFIX.test(card.title)) return card;
	changed += 1;
	return { ...card, title: card.title.replace(PREFIX, '') };
});
console.log(`v${project.version}: ${changed} of ${cards.length} titles to rename, e.g. "${project.production.cards.find((c: { title: string }) => PREFIX.test(c.title))?.title}"`);
if (!DRY && changed) {
	const saved = await fetch(`${base}/api/projects/${id}/production`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, redirect: 'error', body: JSON.stringify({ mode: 'save', expected_version: project.version, production: { ...project.production, cards } }) });
	const body = await saved.json();
	if (!saved.ok || body.ok === false) throw Error(`${saved.status}: ${body.error?.message}`);
	const after = body.data ?? body.project;
	console.log(`saved v${after.version}; cuts ${after.production.cuts?.length}, takes ${after.production.assets.length}, cards ${after.production.cards.length}`);
}
