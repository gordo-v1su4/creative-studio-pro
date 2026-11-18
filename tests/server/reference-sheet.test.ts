import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runFfmpeg } from '../../src/lib/server/ffmpeg';
import { probeMedia } from '../../src/lib/server/media-probe';
import { normalizeReferenceSheet } from '../../src/lib/server/reference-sheet';

test('4K sheets become 2K PNG working copies without modifying the imported source', async () => {
	const root = await mkdtemp(join(tmpdir(), 'studio-sheet-'));
	try {
		const source = join(root, 'original.jpg'), output = join(root, 'working.png');
		await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=gray:s=4096x2304', '-frames:v', '1', source]);
		const before = createHash('sha256').update(await readFile(source)).digest('hex');
		await normalizeReferenceSheet(source, output);
		expect(await probeMedia(output)).toMatchObject({ width: 2048, height: 1152 });
		expect((await readFile(output)).subarray(1, 4).toString()).toBe('PNG');
		expect(createHash('sha256').update(await readFile(source)).digest('hex')).toBe(before);
		// Safe in-place normalization is needed when a series' name band has just been stamped.
		await normalizeReferenceSheet(output, output);
		expect(await probeMedia(output)).toMatchObject({ width: 2048, height: 1152 });
	} finally { await rm(root, { recursive: true, force: true }); }
});
