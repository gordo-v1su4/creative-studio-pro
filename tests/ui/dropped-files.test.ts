import { describe, expect, test } from 'bun:test';
import { droppedFiles, pickedFiles } from '../../src/lib/ui/dropped-files';

// Just enough of the browser's FileSystemEntry API for a drop of files and folders.
const file = (path: string) => {
	const name = path.split('/').pop()!;
	return { name, fullPath: `/${path}`, isFile: true, isDirectory: false, file: (done: (f: File) => void) => done(new File(['x'], name)) };
};
const folder = (path: string, children: unknown[]) => {
	// readEntries hands children back in batches of two, then an empty batch.
	const batches = [children.slice(0, 2), children.slice(2), []];
	return { name: path.split('/').pop()!, fullPath: `/${path}`, isFile: false, isDirectory: true, createReader: () => ({ readEntries: (done: (b: unknown[]) => void) => done(batches.shift() ?? []) }) };
};
const drop = (entries: unknown[]) => ({
	items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
	files: []
}) as unknown as DataTransfer;
const names = (files: File[]) => files.map((f) => f.name);

describe('dropped files', () => {
	test('opens folders all the way down and puts files in natural name order', async () => {
		const files = await droppedFiles(drop([
			folder('renders', [file('renders/shot_10.mp4'), file('renders/shot_2.mp4'), folder('renders/extra', [file('renders/extra/shot_1.png')]), file('renders/shot_1.mp4')]),
			file('a_title.png')
		]));
		expect(names(files)).toEqual(['a_title.png', 'shot_1.png', 'shot_1.mp4', 'shot_2.mp4', 'shot_10.mp4']);
	});

	test('skips hidden files and hidden folders', async () => {
		const files = await droppedFiles(drop([folder('renders', [file('renders/.DS_Store'), file('renders/shot.mp4'), folder('renders/.cache', [file('renders/.cache/x.mp4')])])]));
		expect(names(files)).toEqual(['shot.mp4']);
	});

	test('falls back to the plain file list without the entry API', async () => {
		const data = { items: [{ kind: 'file', webkitGetAsEntry: () => null }, { kind: 'file', webkitGetAsEntry: () => null }], files: [new File(['x'], 'b.png'), new File(['x'], 'a.png')] } as unknown as DataTransfer;
		expect(names(await droppedFiles(data))).toEqual(['a.png', 'b.png']);
	});

	test('a picked folder keeps its folder order', () => {
		const pick = (path: string) => Object.assign(new File(['x'], path.split('/').pop()!), { webkitRelativePath: path });
		const list = [pick('trailer/b/shot_1.mp4'), pick('trailer/a/shot_9.mp4'), pick('trailer/a/shot_10.mp4'), pick('trailer/.DS_Store')] as unknown as FileList;
		expect(names(pickedFiles(list))).toEqual(['shot_9.mp4', 'shot_10.mp4', 'shot_1.mp4']);
	});
});
