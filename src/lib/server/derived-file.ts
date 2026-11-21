import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * One derived file per source (a proxy, a poster), kept at a fixed path named after the source and overwritten
 * in place when the source changes or the settings change: nothing accumulates. A small record beside it notes
 * what it was made from (the source's size and time, plus any settings such as the poster frame).
 */
const inFlight = new Map<string, Promise<string>>();

export async function derivedFile(source: string, cacheDir: string, ext: string, settings: Record<string, unknown>, make: (output: string) => Promise<void>): Promise<string> {
	const id = createHash('sha256').update(source).digest('hex');
	const target = join(cacheDir, id.slice(0, 2), `${id}.${ext}`);
	const recordPath = `${target}.json`;
	const info = await stat(source);
	const wanted = JSON.stringify({ size: info.size, mtime: Math.round(info.mtimeMs), ...settings });
	const current = await readFile(recordPath, 'utf8').catch(() => null);
	if (current === wanted && (await stat(target).then(() => true, () => false))) return target;
	let pending = inFlight.get(target);
	if (!pending) {
		pending = (async () => {
			await mkdir(dirname(target), { recursive: true });
			const partial = `${target}.${process.pid}.tmp.${ext}`;
			await make(partial);
			await rename(partial, target);
			await writeFile(recordPath, wanted, 'utf8');
			return target;
		})().finally(() => inFlight.delete(target));
		inFlight.set(target, pending);
	}
	return pending;
}
