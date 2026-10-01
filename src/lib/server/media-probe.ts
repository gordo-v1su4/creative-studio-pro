import { execFile } from 'node:child_process';

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
