import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('Windows Raycast Creative Room skill contract', () => {
	test('requires the exact persistent-chat, text-only, header-confirmation, capture, reconcile, and restart sequence', async () => {
		const path = resolve(import.meta.dir, '..', '..', '.agents', 'skills', 'raycast-creative-room-windows', 'SKILL.md');
		const skill = await readFile(path, 'utf8');
		expect(skill.split(/\r?\n/).length).toBeLessThan(500);
		expect(skill).toContain('physical `Ctrl`, `Ctrl`');
		expect(skill).toContain('Type `/`, type the exact `active_agent`');
		expect(skill).toContain('Verify automatic extension discovery is off');
		expect(skill).toContain('Confirm its first line begins `TEXT ONLY.`');
		expect(skill).toContain('CSP Confirm Active Model');
		expect(skill).toContain('CSP Capture Last Text Reply');
		expect(skill).toContain('pending count must be zero');
		expect(skill).toContain('without duplicate capture or resubmission');
		expect(skill).toContain('Never generate video');
		expect(skill).not.toContain('Ctrl+Space');
	});
});
