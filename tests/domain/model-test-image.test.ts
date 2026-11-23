import { expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { MODEL_TEST_IMAGE_PNG_BASE64 } from '../../src/lib/domain/model-provider';

// Hyper refuses a malformed picture ("Invalid image attachment format"), so the model test's PNG must be a real one.
test('the model test image is a valid 64x64 PNG', () => {
	const png = Buffer.from(MODEL_TEST_IMAGE_PNG_BASE64, 'base64');
	expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
	let at = 8, width = 0, height = 0; const idat: Buffer[] = []; let ended = false;
	while (at < png.length) {
		const length = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
		expect(at + 12 + length).toBeLessThanOrEqual(png.length);
		const data = png.subarray(at + 8, at + 8 + length);
		if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
		if (type === 'IDAT') idat.push(data);
		if (type === 'IEND') ended = true;
		at += 12 + length;
	}
	expect([width, height, ended]).toEqual([64, 64, true]);
	expect(inflateSync(Buffer.concat(idat)).length).toBe(64 * (1 + 64 * 3));
});
