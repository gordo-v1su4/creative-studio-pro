import { randomUUID } from 'node:crypto';

/** Sortable UUIDv7-shaped id. Never use array position or a display label. */
export function uuid7ish(): string {
	const ts = BigInt(Date.now());
	const tsHex = ts.toString(16).padStart(12, '0');
	const rest = randomUUID().replaceAll('-', '').slice(12);
	const hex = (tsHex + rest).slice(0, 32);
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		'7' + hex.slice(13, 16),
		(randomUUID().slice(0, 1) === 'a' ? '8' : 'b') + hex.slice(17, 20),
		hex.slice(20, 32)
	].join('-');
}

export function randomSeedHex(): string {
	return randomUUID().replaceAll('-', '');
}
