/**
 * The files in a drop, folders opened all the way down, in name order (natural: shot_2 before shot_10), so a
 * folder of numbered renders lands in its numbered order. Hidden files (.DS_Store and the like) are skipped.
 *
 * Call it inside the drop handler before any await: the browser empties the DataTransfer once the event returns,
 * so the entries are taken synchronously and only read afterwards.
 */
export function droppedFiles(data: DataTransfer | null): Promise<File[]> {
	if (!data) return Promise.resolve([]);
	const entries = [...data.items].filter((item) => item.kind === 'file').map((item) => item.webkitGetAsEntry?.() ?? null);
	// No entry API: the plain file list (folders can't be opened there).
	if (entries.length === 0 || entries.some((entry) => !entry)) return Promise.resolve(sorted([...data.files].map((file) => ({ path: file.name, file }))));
	return Promise.all((entries as FileSystemEntry[]).map(read)).then((found) => sorted(found.flat()));
}

/** The files a file input picked (with `webkitdirectory`, a whole folder), in the same order as a drop. */
export function pickedFiles(list: FileList | null): File[] {
	return sorted([...(list ?? [])].map((file) => ({ path: file.webkitRelativePath || file.name, file })));
}

type Found = { path: string; file: File };

const hidden = (name: string) => name.startsWith('.');

function sorted(found: Found[]): File[] {
	return found
		.filter(({ path }) => !path.split('/').some(hidden))
		.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }))
		.map(({ file }) => file);
}

async function read(entry: FileSystemEntry): Promise<Found[]> {
	if (hidden(entry.name)) return [];
	if (entry.isFile) {
		const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
		return [{ path: entry.fullPath.replace(/^\//, ''), file }];
	}
	if (!entry.isDirectory) return [];
	const reader = (entry as FileSystemDirectoryEntry).createReader();
	const children: FileSystemEntry[] = [];
	// readEntries hands back a batch at a time (about 100 in Chrome); keep asking until it returns none.
	for (;;) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
		if (batch.length === 0) break;
		children.push(...batch);
	}
	return (await Promise.all(children.map(read))).flat();
}
