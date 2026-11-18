import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectStore } from '../../src/lib/adapters/project-store';
import { ProjectCommandGateway } from '../../src/lib/application/gateway';
import { saveVerifiedSplit } from '../../src/lib/server/split-shots';
import type { SplitterManifest } from '../../src/lib/domain/groups';

const hasFfmpeg = Bun.spawnSync(['ffmpeg', '-version']).exitCode === 0;

test.skipIf(!hasFfmpeg)('a short second clip discards the already verified first clip and preserves the source and ledger', async () => {
	const root = await mkdtemp(join(tmpdir(), 'csp-split-coverage-'));
	try {
		const store = new ProjectStore({ root });
		const gateway = new ProjectCommandGateway(store);
		const created = await gateway.createProject({ command: 'create_project', title: 'Coverage', brief: '', creative_focus: 'full room', created_by: 'test' });
		if (!created.ok) throw new Error(created.error.message);
		const { project_id } = created.data;
		const projectDir = join(root, project_id);
		const files = join(projectDir, 'files');
		await mkdir(files);
		const source = join(files, 'source.mp4');
		const firstClip = join(root, 'first.mp4');
		const shortClip = join(root, 'short.mp4');
		for (const [path, frames] of [[source, 5], [firstClip, 3], [shortClip, 1]] as const) {
			const encode = Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=24', '-frames:v', String(frames), '-c:v', 'libx264', path]);
			if (encode.exitCode) throw new Error(encode.stderr.toString());
		}
		const beforeSource = await readFile(source);
		const prefix = `/api/projects/${project_id}/files/`;
		const take = { asset_id: 'source', kind: 'video' as const, name: 'source.mp4', url: prefix + 'source.mp4', mime_type: 'video/mp4', created_at: new Date().toISOString() };
		const added = await gateway.addBeat({ command: 'add_beat', project_id, expected_version: created.data.version, card_id: 'main', title: 'Source', take });
		if (!added.ok) throw new Error(added.error.message);
		const manifest: SplitterManifest = { job_id: 'job', frame_rate: 24, frame_count: 5, segment_count: 2, segments: [
			{ index: 1, start_frame: 0, end_frame: 3, frame_count: 3, clip_path: 'first' },
			{ index: 2, start_frame: 3, end_frame: 5, frame_count: 2, clip_path: 'short' }
		] };
		const downloads: string[] = [];
		const groupId = 'test-split';
		const splitAndPublish = async () => {
			const { saved } = await saveVerifiedSplit({
				source, projectDir, groupId, filePrefix: prefix,
				splitter: { split: async () => ({ manifest, download: async (path) => {
					downloads.push(path);
					return readFile(path === 'first' ? firstClip : shortClip);
				} }) }
			});
			return gateway.splitIntoShots(project_id, added.data.version, { group_id: groupId, name: 'Split', source: added.data.production.assets[0], shots: saved, ids: () => crypto.randomUUID() });
		};
		await expect(splitAndPublish()).rejects.toThrow('Split segment 2 decoded 1 frames; expected 2');
		expect(downloads).toEqual(['first', 'short']);
		expect(await store.readProject(project_id)).toEqual(added.data);
		expect(await readFile(source)).toEqual(beforeSource);
		expect(await readdir(files)).toEqual(['source.mp4']);
		expect((await readdir(projectDir)).filter((name) => name.startsWith('.split-'))).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
