import { createHash } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project } from '$lib/domain/schemas';
import { slateFor } from '$lib/domain/slate';
import { runFfmpeg } from './ffmpeg';

/** Fonts tried in order: the hosted container's DejaVu, then common desktop fonts. */
const FONTS = [
	'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
	'/usr/share/fonts/TTF/DejaVuSans.ttf',
	'C:/Windows/Fonts/segoeui.ttf',
	'C:/Windows/Fonts/arial.ttf',
	'/System/Library/Fonts/Supplemental/Arial.ttf',
	'/Library/Fonts/Arial.ttf'
].filter((path): path is string => !!path);

async function exists(path: string) {
	try { await access(path); return true; } catch { return false; }
}

let fontFile: string | null | undefined;
async function font(): Promise<string | null> {
	if (fontFile !== undefined) return fontFile;
	for (const path of FONTS) if (await exists(path)) return (fontFile = path);
	return (fontFile = null);
}

/** A path inside an ffmpeg filter argument: forward slashes, and the drive colon escaped. */
const filterPath = (path: string) => path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Break text into lines of at most `width` characters, on spaces. */
export function wrap(text: string, width: number, maxLines: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
		if (!word) continue;
		if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; }
		else line = line ? `${line} ${word}` : word;
		if (lines.length === maxLines) break;
	}
	if (line && lines.length < maxLines) lines.push(line);
	if (lines.length === maxLines && text.length > lines.join(' ').length + 1) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,1}$/, '…');
	return lines;
}

/**
 * The slate video for a missing shot: 1920×1080, 24 fps, silent stereo track (so it joins any cut), the planned length,
 * and the shot's code, order, title and story beat as plain text. Cached under the project's files by its content.
 */
export async function ensureSlate(projectRoot: string, project: Project, cardId: string): Promise<{ file: string; name: string; url: string }> {
	const card = project.production.cards.find((entry) => entry.card_id === cardId);
	if (!card) throw new Error(`Shot ${cardId} is not in this project`);
	const slate = slateFor(project, card);
	const lines = {
		code: slate.code || 'no shot code yet',
		order: slate.order,
		title: wrap(slate.title, 48, 2).join('\n'),
		beat: wrap(slate.beat, 72, 5).join('\n'),
		note: `missing shot · ${slate.duration_s.toFixed(1)} s planned`
	};
	const hash = createHash('sha256').update(JSON.stringify([lines, slate.duration_s, 1])).digest('hex').slice(0, 16);
	const name = `${cardId}-${hash}.mp4`;
	const folder = join(projectRoot, project.project_id, 'files', 'slates');
	const file = join(folder, name);
	const url = `/api/projects/${project.project_id}/files/slates/${encodeURIComponent(name)}`;
	if (await exists(file)) return { file, name, url };
	await mkdir(folder, { recursive: true });
	const fontPath = await font();
	if (!fontPath) throw new Error('No font found for the missing-shot card (looked for DejaVu Sans, Segoe UI and Arial)');
	const texts = Object.fromEntries(await Promise.all(Object.entries(lines).map(async ([key, text]) => {
		const path = join(folder, `${hash}-${key}.txt`);
		await writeFile(path, text, 'utf8');
		return [key, path] as const;
	})));
	const fontArg = `fontfile='${filterPath(fontPath)}'`;
	const draw = (key: string, size: number, color: string, y: string, spacing = 10) =>
		`drawtext=${fontArg}:textfile='${filterPath(texts[key])}':fontsize=${size}:fontcolor=${color}:line_spacing=${spacing}:x=160:y=${y}`;
	const filter = [
		'drawbox=x=120:y=150:w=4:h=780:color=0x2c7c6c@1:t=fill',
		draw('code', 64, '0x7bd7c6', '180'),
		draw('order', 30, '0x819fa5', '280'),
		draw('title', 54, '0xd7efed', '360', 14),
		draw('beat', 34, '0xb9d0d2', '520', 14),
		draw('note', 26, '0x5f8188', '880')
	].join(',');
	try {
		await runFfmpeg(['-v', 'error', '-y',
			'-f', 'lavfi', '-i', `color=c=0x0c141a:s=1920x1080:r=24:d=${slate.duration_s}`,
			'-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`,
			'-vf', filter, '-t', String(slate.duration_s), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
			'-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', file]);
	} finally {
		await Promise.all(Object.values(texts).map((path) => rm(path, { force: true })));
	}
	return { file, name, url };
}
