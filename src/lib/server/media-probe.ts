import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runProbe = promisify(execFile);

/** Decode the video stream and refuse unreadable, partial or corrupt results. */
export async function probeDecodedVideo(file: string) {
	const { stdout, stderr } = await runProbe('ffprobe', [
		'-v', 'error', '-count_frames', '-select_streams', 'v:0',
		'-show_entries', 'stream=nb_read_frames,avg_frame_rate,width,height', '-of', 'json', file
	], { timeout: 120_000 });
	const { streams } = JSON.parse(stdout);
	const stream = streams?.[0];
	const frames = Number(stream?.nb_read_frames);
	const [numerator, denominator] = String(stream?.avg_frame_rate).split('/').map(Number);
	const fps = numerator / denominator;
	if (stderr.trim() || !Number.isSafeInteger(frames) || frames < 1 || !Number.isFinite(fps) || fps <= 0) {
		throw new Error('Could not verify decoded video frames and frame rate');
	}
	return { frames, fps, width: Number(stream.width) || undefined, height: Number(stream.height) || undefined };
}

export interface MediaProbe {
	width?: number;
	height?: number;
	duration_s?: number;
}

/**
 * Width, height and (for video) duration of a media file via ffprobe on PATH.
 * Returns what it could read; an absent or failing ffprobe yields {} rather
 * than blocking intake.
 */
export function probeMedia(file: string): Promise<MediaProbe> {
	return new Promise((resolve) => {
		execFile(
			'ffprobe',
			['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file],
			{ timeout: 15_000 },
			(error, stdout) => {
				if (error) return resolve({});
				try {
					const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
					const stream = parsed.streams?.[0];
					const duration = Number(parsed.format?.duration);
					resolve({
						...(stream?.width && stream.height ? { width: stream.width, height: stream.height } : {}),
						...(Number.isFinite(duration) && duration > 0 ? { duration_s: duration } : {})
					});
				} catch {
					resolve({});
				}
			}
		);
	});
}
