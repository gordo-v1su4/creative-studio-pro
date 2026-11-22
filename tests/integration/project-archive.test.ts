import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('archiving only flags a project: the list carries the flag, everything else is kept, and unarchiving clears it', async () => {
	const root = await mkdtemp(join(tmpdir(), 'csp-archive-')); roots.push(root);
	const store = new ProjectStore({ root });
	const made = await store.createProject({ title: 'TR105 — Teaser Trailer', brief: 'Old trailer', creative_focus: 'full room', created_by: 'test' });
	expect(made.archived_at).toBeNull();
	const archived = await store.updateProject(made.project_id, made.version, (p) => ({ ...p, archived_at: '2026-11-22T08:00:00.000Z' }));
	const listed = (await store.listProjects()).find((p) => p.project_id === made.project_id);
	expect(listed?.archived_at).toBe('2026-11-22T08:00:00.000Z');
	expect(archived.title).toBe(made.title);
	expect(archived.production).toEqual(made.production);
	const back = await store.updateProject(archived.project_id, archived.version, (p) => ({ ...p, archived_at: null }));
	expect((await store.listProjects()).find((p) => p.project_id === back.project_id)?.archived_at).toBeNull();
});
