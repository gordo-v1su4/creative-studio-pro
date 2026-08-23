import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('Stage Agent dependencies remain Svelte-only with no React chat framework', async () => {
	const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
	const names = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies ?? {})];
	expect(names.some((name) => name === 'react' || name === 'react-dom' || name === '@ai-sdk/react')).toBeFalse();
	expect(names.some((name) => name.includes('assistant-ui') || name.includes('copilot'))).toBeFalse();
	expect(names).toContain('@ai-sdk/svelte');
	const lock = await readFile('bun.lock', 'utf8');
	expect(lock).not.toContain('react@');
});
