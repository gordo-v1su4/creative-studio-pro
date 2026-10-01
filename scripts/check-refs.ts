// Usage: bun scripts/check-refs.ts <image> [<image> …]
// Gate every reference image before it is uploaded to a generator: the long edge must be at
// least 2048 px (operator rule: nothing under 2K, never HD or a chat-paste copy), and annotated
// refs (guide arcs, marked boards) are refused because the model draws the annotation on screen.
// Exits 1 when any file fails.
const MIN_LONG_EDGE = 2048;
const ANNOTATED = /(arc|annotat|marked|guide)/i;

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: bun scripts/check-refs.ts <image> [<image> …]');
	process.exit(2);
}

let failed = 0;
for (const file of files) {
	const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
	const [width, height] = probe.stdout.toString().trim().split(',').map(Number);
	const problems: string[] = [];
	if (!width || !height) problems.push('unreadable');
	else if (Math.max(width, height) < MIN_LONG_EDGE) problems.push(`${width}×${height} is under 2K — pull the original from super-seed2 assets`);
	if (ANNOTATED.test(file.split(/[\\/]/).pop() ?? '')) problems.push('annotated ref — the model draws the annotation on screen');
	if (problems.length) failed++;
	console.log(`${problems.length ? '✗' : '✓'} ${file}${width ? ` (${width}×${height})` : ''}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
}
process.exit(failed > 0 ? 1 : 0);
