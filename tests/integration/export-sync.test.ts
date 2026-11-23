import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { buildMix } from '../../src/lib/server/sound';
import { exportCut } from '../../src/lib/server/export';

const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;

/**
 * Sound stays on its picture to the end of a long cut. Twelve 1.02 s entries: rounding each entry to
 * whole frames on its own made every picture 1.00 s while its sound kept 1.02 s, 20 ms of drift per
 * entry (240 ms by the last). Picture and mix now share one frame grid; the export's QC report
 * measures every entry's take sound against its picture.
 */
test.skipIf(!hasFfmpeg)('a long cut of 1.02 s entries exports with every entry\'s sound on its picture', async () => {
	const root = await mkdtemp(join(tmpdir(), 'csp-export-sync-'));
	try {
		const store = new ProjectStore({ root });
		const gateway = new ProjectCommandGateway(store);
		const must = <T>(r: { ok: true; data: T } | { ok: false; error: { message: string } }): T => { if (!r.ok) throw new Error(r.error.message); return r.data; };
		let project = must(await gateway.createProject({ command: 'create_project', title: 'Sync', brief: '', creative_focus: 'full room', created_by: 'test' }));
		const files = join(root, project.project_id, 'files');
		await mkdir(files, { recursive: true });
		const encode = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=16', '-f', 'lavfi', '-i', 'anoisesrc=d=16:c=pink:seed=3:a=0.3', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', join(files, 'take.mp4')]);
		if (encode.exitCode) throw new Error(encode.stderr.toString());
		const prefix = `/api/projects/${project.project_id}/files/`;
		project = must(await gateway.addBeat({ command: 'add_beat', project_id: project.project_id, expected_version: project.version, card_id: 'shot', title: 'Shot', take: { asset_id: 'take', kind: 'video', name: 'take.mp4', url: `${prefix}take.mp4`, mime_type: 'video/mp4', created_at: new Date().toISOString(), duration_s: 16 } }));
		// Twelve different 1.02 s stretches of the same take, so each entry's sound is its own.
		const entries = Array.from({ length: 12 }, (_, i) => ({ card_id: 'shot', asset_id: 'take', in_s: 0.5 + i * 1.2, out_s: 0.5 + i * 1.2 + 1.02 }));
		project = must(await gateway.pushCut({ command: 'push_cut', project_id: project.project_id, expected_version: project.version, name: 'Long cut', entries }));
		const cut = project.production.cuts!.at(-1)!;
		project = must(await gateway.lockCut({ command: 'lock_cut', project_id: project.project_id, expected_version: project.version, cut_id: cut.cut_id }));
		const deps = { gateway, store, projectRoot: root };
		const mixed = await buildMix(deps, project.project_id, cut.cut_id, 1);
		if (!mixed.ok) throw new Error(mixed.message);
		const exported = await exportCut(deps, project.project_id, cut.cut_id, 1);
		if (!exported.ok) throw new Error(exported.message);

		const sync = exported.qc.checks.find((c) => c.id === 'lip_sync')!;
		const measured = sync.items.filter((i) => / take sound [+−]/.test(i.message));
		expect(measured.length).toBeGreaterThanOrEqual(10);
		for (const item of measured) expect(item.status).toBe('pass');
		expect(exported.qc.checks.find((c) => c.id === 'length')!.status).toBe('pass');
		// The last entry starts at 11 × 1.02 s = 11.22 s ≈ frame 269 (11.208 s), within half a frame of the plan.
		expect(Math.abs(measured.at(-1)!.at_s! - 11.22)).toBeLessThanOrEqual(0.5 / 24 + 1e-6);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 300_000);
