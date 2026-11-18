import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import ts from 'typescript';

// Execute the component's actual handlers with controlled async dependencies.
// This tests races without requiring a decoder or mutating a real project.
function handlers(path: string, names: string[], environment: Record<string, unknown>, setup = '', result = '') {
	const source = readFileSync(path, 'utf8');
	const script = parse(source).instance!.content;
	const code = source.slice(script.start, script.end);
	const ast = ts.createSourceFile(path + '.ts', code, ts.ScriptTarget.Latest, true);
	const functions = names.map((name) => {
		const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
		if (!declaration) throw new Error(`Missing handler ${name}`);
		return declaration.getText(ast);
	}).join('\n');
	const js = ts.transpile(`${setup}\n${functions}\nreturn { ${names.join(', ')}, ${result} };`, { target: ts.ScriptTarget.ESNext });
	return new Function(...Object.keys(environment), js)(...Object.values(environment));
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = <T>() => Promise.withResolvers<T>();
const player = 'src/lib/ui/SequencePlayer.svelte';

test('a late reload cannot replace the bank of a newly chosen take', async () => {
	const pending = deferred<unknown>();
	const old = { id: 'entry', src: 'old.mp4', assetId: 'old', in: 0 };
	const clips = [old];
	const { startBankLoad } = handlers(player, ['startBankLoad'], {
		clips, MAX_HEIGHT: 288, loadBank: () => pending.promise
	}, 'const reloading = new Set<string>();');
	startBankLoad(old);
	const replacement = { ...old, src: 'new.mp4', assetId: 'new', bank: { name: 'new picture' } };
	clips[0] = replacement;
	pending.resolve({ name: 'old picture' });
	await settled();
	expect(clips[0]).toBe(replacement);
});

test('a valid reload preserves edits made while decoding', async () => {
	const pending = deferred<unknown>();
	const old = { id: 'entry', src: 'clip.mp4', assetId: 'take', in: 0 };
	const clips: Array<typeof old & { bank?: unknown }> = [old];
	const { startBankLoad } = handlers(player, ['startBankLoad'], {
		clips, MAX_HEIGHT: 288, loadBank: () => pending.promise
	}, 'const reloading = new Set<string>();');
	startBankLoad(old);
	clips[0] = { ...old, in: 2 };
	const bank = { name: 'picture' };
	pending.resolve(bank);
	await settled();
	expect(clips[0].bank).toBe(bank);
	expect(clips[0].in).toBe(2);
});

test('an oversized prefetch is probed once and never uploaded', async () => {
	let probes = 0, loads = 0;
	const clips = [
		{ id: 'playing', src: 'a', bank: { stats: { ready: true, bytes: 60 }, frameAt: () => ({}) } },
		{ id: 'next', src: 'b', assetId: 'b', in: 0 }
	];
	const { ensureBank } = handlers(player, ['ensureBank'], {
		clips, index: 0, MAX_HEIGHT: 288,
		getResidentBudget: () => ({ limit: 100, available: 40 }),
		estimateBankBytes: async () => { probes++; return 60; },
		startBankLoad: () => { loads++; }
	}, "const reloading = new Set<string>(); let prefetchFor = '';");
	for (let i = 0; i < 20; i++) { ensureBank(1); await settled(); }
	expect(probes).toBe(1);
	expect(loads).toBe(0);
});

test('prefetch rechecks capacity after its async metadata probe', async () => {
	const pending = deferred<number>();
	let available = 100, loads = 0;
	const clips = [
		{ id: 'playing', src: 'a', bank: { stats: { ready: true, bytes: 40 } } },
		{ id: 'next', src: 'b', assetId: 'b', in: 0 }
	];
	const { ensureBank } = handlers(player, ['ensureBank'], {
		clips, index: 0, MAX_HEIGHT: 288,
		getResidentBudget: () => ({ limit: available + 40, available }), estimateBankBytes: () => pending.promise,
		startBankLoad: () => { loads++; }
	}, "const reloading = new Set<string>(); let prefetchFor = '';");
	ensureBank(1);
	available = 20;
	pending.resolve(60);
	await settled();
	expect(loads).toBe(0);
});

test('prefetch can reclaim old unpinned clips when the playing and next banks fit together', async () => {
	let loads = 0;
	const clips = [
		{ id: 'playing', src: 'a', bank: { stats: { ready: true, bytes: 40 } } },
		{ id: 'next', src: 'b', assetId: 'b', in: 0 }
	];
	const { ensureBank } = handlers(player, ['ensureBank'], {
		clips, index: 0, MAX_HEIGHT: 288,
		getResidentBudget: () => ({ limit: 100, available: 0 }),
		estimateBankBytes: async () => 40,
		startBankLoad: () => { loads++; }
	}, "const reloading = new Set<string>(); let prefetchFor = '';");
	ensureBank(1);
	await settled();
	expect(loads).toBe(1);
});

test('the next clip starts prefetching at the beginning, not halfway through a short shot', () => {
	const prefetched: number[] = [];
	const clip = { id: 'entry', in: 0, out: 2, bank: { duration: 2, frameAt: () => ({ view: {} }) } };
	const { tick } = handlers(player, ['tick'], {
		clips: [clip, { ...clip, id: 'next' }], index: 0, paused: false, scrubbing: false, rate: 1,
		voices: new Map(), song: null, draw: null,
		ensureBank: (i: number) => prefetched.push(i), pauseAll: () => {}, syncAudio: () => {}, requestAnimationFrame: () => 1
	}, 'let buffering = false, playhead = 0, lastTick = 1000, frame = 0;');
	tick(1016);
	expect(prefetched).toContain(1);
});

test('a missing bank holds picture time and sound until decoding finishes', () => {
	let ready = false, pauses = 0, resumes = 0;
	const clip = { id: 'entry', in: 0, out: 10, bank: { duration: 10, frameAt: () => ready ? { view: {} } : null } };
	const { tick, time } = handlers(player, ['tick'], {
		clips: [clip], index: 0, paused: false, scrubbing: false, rate: 1,
		voices: new Map(), song: null, draw: null,
		ensureBank: () => {}, pauseAll: () => { pauses++; },
		syncAudio: () => { resumes++; }, requestAnimationFrame: () => 1
	}, 'let buffering = false, playhead = 1, lastTick = 1000, frame = 0;', 'time: () => playhead');
	tick(1100);
	tick(1200);
	expect(time()).toBe(1);
	expect(pauses).toBe(1);
	expect(resumes).toBe(0);
	ready = true;
	tick(1300);
	expect(time()).toBeCloseTo(1.1);
	expect(resumes).toBe(1);
});

test('Refs prefers a local replacement and rejects an aborted response', async () => {
	const pending = deferred<unknown>();
	const data = { ok: true, data: { items: [
		{ entry: { key: 'hero', name: 'Hero', kind: 'character' }, state: { result: { url: 'local?v=2' } }, current: { url: 'inherited' } },
		{ entry: { key: 'place', name: 'Place', kind: 'location' }, state: {}, current: { url: 'fallback' } }
	] } };
	const { loadPrepRefs, refs } = handlers('src/routes/+page.svelte', ['loadPrepRefs'], {
		fetch: () => pending.promise
	}, "let prepRefsFor = 'trailer'; let prepRefs = [];", 'refs: () => prepRefs');
	const cancelled = new AbortController();
	loadPrepRefs('trailer', cancelled.signal);
	cancelled.abort();
	pending.resolve({ json: async () => data });
	await settled();
	expect(refs()).toEqual([]);
	loadPrepRefs('trailer', new AbortController().signal);
	await settled();
	expect(refs().map((ref: { url: string }) => ref.url)).toEqual(['local?v=2', 'fallback']);
});
