import { programElapsed, type SpeedPoint } from '../media/speed-curve';
import { rampChunks } from './sound';
import type { ProductionAsset } from './schemas';

/**
 * Export (V1S-130), pure: render plans (ffmpeg arguments) for the per-entry
 * intermediates with trims and speed ramps baked in and for the MP4, and the
 * FCPXML that DaVinci Resolve imports as a timeline. Everything is on one
 * frame grid so the timeline and the files agree exactly.
 */

export const EXPORT_FPS = 24;
export const EXPORT_SIZE = { width: 1920, height: 1080 } as const;

/** Seconds → whole frames at the export rate. */
export const toFrames = (seconds: number) => Math.max(1, Math.round(seconds * EXPORT_FPS));
/** Frames → an FCPXML rational time. */
const t = (frames: number) => (frames === 0 ? '0s' : `${frames}/${EXPORT_FPS}s`);

/**
 * One entry baked to an intermediate: its kept span, its ramp rendered in
 * (each piece retimed), scaled and padded to the export frame, every frame a
 * keyframe so Resolve scrubs and cuts it cleanly. Video only; sound comes
 * from the mix and stems.
 */
export function bakePlan(input: { file: string; in_s: number; out_s: number; speed?: SpeedPoint[]; output: string }): { args: string[]; frames: number } {
	const frames = toFrames(programElapsed(input.speed, input.out_s - input.in_s));
	const chunks = rampChunks(input, 0.25).map((chunk, i) => ({ ...chunk, label: `p${i}` }));
	const { width, height } = EXPORT_SIZE;
	const pieces = chunks.map((chunk) => `[0:v]trim=start=${chunk.from.toFixed(4)}:end=${chunk.to.toFixed(4)},setpts=(PTS-STARTPTS)/${chunk.rate}[${chunk.label}]`);
	const joined = chunks.length > 1 ? `${chunks.map((c) => `[${c.label}]`).join('')}concat=n=${chunks.length}:v=1:a=0[joined]` : null;
	const graph = [...pieces, ...(joined ? [joined] : []), `[${joined ? 'joined' : chunks[0].label}]fps=${EXPORT_FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v]`].join(';');
	return {
		frames,
		args: ['-y', '-v', 'error', '-i', input.file, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-g', '1', '-r', String(EXPORT_FPS), '-frames:v', String(frames), input.output]
	};
}

/** The MP4: the intermediates back to back, with the mix. */
export function mp4Plan(input: { intermediates: string[]; mix: string; output: string }): string[] {
	const k = input.intermediates.length;
	const args = ['-y', '-v', 'error'];
	for (const file of input.intermediates) args.push('-i', file);
	args.push('-i', input.mix);
	const graph = `${input.intermediates.map((_, i) => `[${i}:v]`).join('')}concat=n=${k}:v=1:a=0[v]`;
	args.push('-filter_complex', graph, '-map', '[v]', '-map', `${k}:a`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', input.output);
	return args;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A local path as a file:// URL (Windows drive letters included). */
export function fileUrl(path: string): string {
	const slashed = path.replace(/\\/g, '/');
	return `file://${slashed.startsWith('/') ? '' : '/'}${slashed.split('/').map((part, i) => (i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part))).join('/')}`;
}

export interface TimelineClip { name: string; file: string; frames: number }
export interface TimelineAudio { name: string; file: string; frames: number }

/**
 * FCPXML 1.9 for Resolve: one sequence on the export frame grid, the baked
 * clips in order on the spine (their trims and ramps are in the files), and
 * the mix and stems as connected audio under the first clip, each on its own
 * lane, running the length of the cut.
 */
export function buildFcpxml(input: { title: string; clips: TimelineClip[]; audio: TimelineAudio[] }): string {
	const { width, height } = EXPORT_SIZE;
	const total = input.clips.reduce((sum, clip) => sum + clip.frames, 0);
	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE fcpxml>', '<fcpxml version="1.9">', '\t<resources>');
	lines.push(`\t\t<format id="r0" name="FFVideoFormat${height}p${EXPORT_FPS}" frameDuration="1/${EXPORT_FPS}s" width="${width}" height="${height}"/>`);
	input.clips.forEach((clip, i) => {
		lines.push(`\t\t<asset id="v${i + 1}" name="${escapeXml(clip.name)}" start="0s" duration="${t(clip.frames)}" hasVideo="1" format="r0" hasAudio="0">`);
		lines.push(`\t\t\t<media-rep kind="original-media" src="${escapeXml(fileUrl(clip.file))}"/>`, '\t\t</asset>');
	});
	input.audio.forEach((track, i) => {
		lines.push(`\t\t<asset id="a${i + 1}" name="${escapeXml(track.name)}" start="0s" duration="${t(track.frames)}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000">`);
		lines.push(`\t\t\t<media-rep kind="original-media" src="${escapeXml(fileUrl(track.file))}"/>`, '\t\t</asset>');
	});
	lines.push('\t</resources>', '\t<library>', '\t\t<event name="Narrate export">', `\t\t\t<project name="${escapeXml(input.title)}">`);
	lines.push(`\t\t\t\t<sequence format="r0" duration="${t(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`, '\t\t\t\t\t<spine>');
	let offset = 0;
	input.clips.forEach((clip, i) => {
		const open = `\t\t\t\t\t\t<asset-clip ref="v${i + 1}" name="${escapeXml(clip.name)}" offset="${t(offset)}" start="0s" duration="${t(clip.frames)}" format="r0" tcFormat="NDF"`;
		if (i === 0 && input.audio.length) {
			lines.push(`${open}>`);
			input.audio.forEach((track, a) => lines.push(`\t\t\t\t\t\t\t<asset-clip ref="a${a + 1}" lane="-${a + 1}" name="${escapeXml(track.name)}" offset="0s" start="0s" duration="${t(Math.min(track.frames, total))}"/>`));
			lines.push('\t\t\t\t\t\t</asset-clip>');
		} else lines.push(`${open}/>`);
		offset += clip.frames;
	});
	lines.push('\t\t\t\t\t</spine>', '\t\t\t\t</sequence>', '\t\t\t</project>', '\t\t</event>', '\t</library>', '</fcpxml>', '');
	return lines.join('\n');
}

/** Takes in the cut that aren't at full resolution yet: unfinalized drafts, or under 1080 lines. */
export function draftTakes(entries: Array<{ title: string; take: Pick<ProductionAsset, 'name' | 'height' | 'width' | 'generation'> | undefined }>): Array<{ title: string; name: string; why: string }> {
	return entries.flatMap(({ title, take }) => {
		if (!take) return [{ title, name: '(missing take)', why: 'the take is missing' }];
		if (take.generation?.draft && !take.generation.finalized_at) return [{ title, name: take.name, why: `480p draft${take.generation.resolution ? ` (${take.generation.resolution})` : ''}, not finalized` }];
		const lines = Math.min(take.width ?? Infinity, take.height ?? Infinity);
		if (Number.isFinite(lines) && lines < 1080) return [{ title, name: take.name, why: `${take.width}×${take.height}, under 1080` }];
		return [];
	});
}
