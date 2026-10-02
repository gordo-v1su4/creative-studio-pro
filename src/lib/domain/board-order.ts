/**
 * Reading order for beats picked together on the board: row by row, top to
 * bottom, left to right within a row. Cards whose tops sit within `rowTolerance`
 * of a row's first card count as that row, so a slightly dragged card stays put.
 */
export interface Placed { id: string; x: number; y: number }

export function readingOrder<T extends Placed>(items: T[], rowTolerance = 150): T[] {
	const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
	const rows: T[][] = [];
	for (const item of byTop) {
		const row = rows.at(-1);
		if (row && item.y - row[0].y <= rowTolerance) row.push(item);
		else rows.push([item]);
	}
	return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
