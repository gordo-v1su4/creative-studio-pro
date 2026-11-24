import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppSettingsStore, appSettingsPath, applyNotionSettings, emptyAppSettings, notionSettingsView, notionTokenFrom } from '../../src/lib/server/app-settings';
import { checkNotionKey } from '../../src/lib/server/notion';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const withKey = (key: string | null) => ({ ...emptyAppSettings(), notion: { api_key: key, template_url: null } });

test('the key entered in Settings is the one used; the NOTION_TOKEN variable is the fallback; with neither there is no Notion', () => {
	expect(notionTokenFrom(withKey('from-settings'), 'from-env')).toBe('from-settings');
	expect(notionTokenFrom(withKey(null), 'from-env')).toBe('from-env');
	expect(notionTokenFrom(withKey('   '), ' from-env ')).toBe('from-env');
	expect(notionTokenFrom(withKey(null), undefined)).toBeNull();
	expect(notionTokenFrom(emptyAppSettings(), '')).toBeNull();
});

test('the browser learns whether there is a key and where it comes from, never the key', () => {
	expect(notionSettingsView(withKey('secret-key'), 'env-key')).toEqual({ has_key: true, source: 'settings', template_url: null });
	expect(notionSettingsView(withKey(null), 'env-key')).toEqual({ has_key: true, source: 'environment', template_url: null });
	expect(notionSettingsView(withKey(null), null)).toEqual({ has_key: false, source: null, template_url: null });
	expect(JSON.stringify(notionSettingsView(withKey('secret-key'), 'env-key'))).not.toMatch(/secret-key|env-key/);
});

test('a field left out is kept; null or nothing clears it; the template address must be a public https page', () => {
	const start = { ...emptyAppSettings(), notion: { api_key: 'k1', template_url: 'https://www.notion.so/Series-Template-abc' } };
	const kept = applyNotionSettings(start, { template_url: 'https://example.notion.site/Template' });
	if (!kept.ok) throw new Error(kept.message);
	expect(kept.settings.notion).toEqual({ api_key: 'k1', template_url: 'https://example.notion.site/Template' });
	const cleared = applyNotionSettings(start, { api_key: null, template_url: '' });
	if (!cleared.ok) throw new Error(cleared.message);
	expect(cleared.settings.notion).toEqual({ api_key: null, template_url: null });
	expect(applyNotionSettings(start, { template_url: 'http://www.notion.so/x' })).toEqual({ ok: false, message: 'The template address must start with https://' });
	expect(applyNotionSettings(start, { template_url: 'the template' })).toEqual({ ok: false, message: 'The template address is not a web address' });
	// Nothing else in the settings is touched.
	const other = { ...start, sfx_folder: '/sounds' };
	const changed = applyNotionSettings(other, { api_key: 'k2' });
	expect(changed.ok && changed.settings.sfx_folder).toBe('/sounds');
});

test('the key is kept in the server-side settings file, outside every project', async () => {
	const root = await mkdtemp(join(tmpdir(), 'csp-notion-')); roots.push(root);
	const store = new AppSettingsStore(appSettingsPath(join(root, 'projects')));
	await store.update((current) => { const next = applyNotionSettings(current, { api_key: 'secret-key', template_url: 'https://www.notion.so/Template' }); if (!next.ok) throw new Error(next.message); return next.settings; });
	expect((await store.read()).notion).toEqual({ api_key: 'secret-key', template_url: 'https://www.notion.so/Template' });
	expect(store.path.startsWith(join(root, 'projects'))).toBe(false);
	expect(await readFile(store.path, 'utf8')).toContain('secret-key');
	// A settings file from before Notion lived here still reads, with no key.
	expect(emptyAppSettings().notion).toEqual({ api_key: null, template_url: null });
});

test('a key is checked with Notion before it is saved: refused, accepted, or not reachable', async () => {
	expect(await checkNotionKey('good', async () => ({ name: 'Creative Studio Pro' }))).toEqual({ ok: true, name: 'Creative Studio Pro' });
	expect(await checkNotionKey('bad', async () => { throw Object.assign(new Error('API token is invalid.'), { code: 'unauthorized', status: 401 }); })).toEqual({ ok: false, refused: true, message: 'Notion refused that key. Copy the connection token again.' });
	expect(await checkNotionKey('any', async () => { throw new Error('fetch failed'); })).toEqual({ ok: false, refused: false, message: 'fetch failed' });
});

test('nothing reaches Notion without a key: every route that opens the Notion API first checks for one', () => {
	const files: string[] = [];
	const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (name.endsWith('.ts')) files.push(path); } };
	walk('src/routes'); files.push('src/lib/server/config.ts');
	const callers = files.filter((file) => /createNotionApi\(|pageTitle\(/.test(readFileSync(file, 'utf8')));
	expect(callers.length).toBeGreaterThanOrEqual(5);
	for (const file of callers) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/createNotionApi\((\w+)\)/g)) {
			const name = match[1], before = source.slice(0, match.index);
			// Either a refusal when the key is missing, or the API made only when there is one.
			const guarded = new RegExp(`if \\(!${name}\\)`).test(before) || new RegExp(`${name} \\? createNotionApi\\(${name}\\)|${name} \\? createStoryWriter`).test(source) || new RegExp(`&& ${name} \\? `).test(before.slice(-200));
			expect({ file, guarded }).toEqual({ file, guarded: true });
		}
	}
});
