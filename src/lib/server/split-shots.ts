import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { shotsOf } from '$lib/domain/groups';
import { probeDecodedVideo } from './media-probe';
import type { Splitter } from './splitter';

/** Stage all clips outside the served files tree until every range and clip passes. */
export async function saveVerifiedSplit(input: {
	source: string;
	splitter: Pick<Splitter, 'split'>;
	projectDir: string;
	groupId: string;
	filePrefix: string;
}) {
	const source = await probeDecodedVideo(input.source);
	const result = await input.splitter.split(input.source);
	const shots = shotsOf(result.manifest, source);
	const stage = await mkdtemp(join(input.projectDir, '.split-'));
	const parent = join(input.projectDir, 'files', 'shots');
	const folder = join(parent, input.groupId);
	const saved = [];
	const segments = [];
	let outputFrames = 0;
	try {
		for (const shot of shots) {
			const file = join(stage, shot.file_name);
			await writeFile(file, await result.download(shot.clip_path));
			const clip = await probeDecodedVideo(file).catch(() => {
				throw new Error(`Split segment ${shot.index} is unreadable or corrupt`);
			});
			if (clip.frames !== shot.frame_count) {
				throw new Error(`Split segment ${shot.index} decoded ${clip.frames} frames; expected ${shot.frame_count}`);
			}
			outputFrames += clip.frames;
			segments.push({ index: shot.index, start_frame: shot.start_frame, end_frame: shot.end_frame, frame_count: clip.frames });
			saved.push({
				...shot, url: `${input.filePrefix}shots/${input.groupId}/${shot.file_name}`,
				width: clip.width, height: clip.height
			});
		}
		await mkdir(parent, { recursive: true });
		await rename(stage, folder);
	} catch (error) {
		await rm(stage, { recursive: true, force: true });
		throw error;
	}
	return { saved, folder, coverage: { source_fps: source.fps, source_frames: source.frames, output_frames: outputFrames, segments } };
}
