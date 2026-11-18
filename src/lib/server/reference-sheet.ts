import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runFfmpeg } from './ffmpeg';

/** A 2K PNG working sheet; the imported/generated source file is left untouched. Never upscale. */
export async function normalizeReferenceSheet(input: string, output: string): Promise<string> {
	await mkdir(dirname(output), { recursive: true });
	const temporary = join(dirname(output), `.sheet-${randomUUID()}.png`);
	try {
		await runFfmpeg(['-y', '-i', input, '-frames:v', '1', '-vf', 'scale=w=min(2048\\,iw):h=min(2048\\,ih):force_original_aspect_ratio=decrease', temporary]);
		await rename(temporary, output);
		return output;
	} finally { await rm(temporary, { force: true }); }
}
