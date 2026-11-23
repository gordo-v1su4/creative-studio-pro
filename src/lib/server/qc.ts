import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CutMusic } from '$lib/domain/schemas';
import { songTimeAt, type MusicPiece } from '$lib/domain/sound';
import {
	LIP_SYNC_S, SEARCH_S, SILENCE_DB, SILENCE_MIN_S, bestOffset, dialogueMatch, finishReport, lengthCheck, levelDb, loudestWindow, offsetItem,
	parseLoudness, parseSilences, soundCheck, timecode, worst, type QcCheck, type QcEntry, type QcItem, type QcReport
} from '$lib/domain/qc';
import { PCM_RATE, readPcm } from '$lib/server/audio-envelope';

/** What a QC run checks a render against. Without entries, only picture ends, sound and length are checked. */
export interface QcInput {
	/** The rendered cut MP4 on disk. */
	file: string;
	/** How the report names the file (its project URL); defaults to the path. */
	label?: string;
	/** Where the contact sheet and qc.json go. */
	outDir: string;
	/** The contact sheet's URL when it is served (export folder); else its path. */
	sheetUrl?: string;
	fps: number;
	entries: QcEntry[];
	/** The planned length (whole export frames); null = unknown. */
	planned_s: number | null;
	/** The cut's song when the music layer is on: from the cut's start, or laid out by its flow pieces. */
	music?: { file: string; sections?: CutMusic['sections']; pieces?: MusicPiece[] } | null;
	/** Crossfade at every cut (seconds): sync windows stay clear of it. */
	crossfade_s: number;
	/** Take sound muted in the mix: lip sync can't be read from the render. */
	take_muted?: boolean;
	/** Run local ASR (faster-whisper via uv) on dialogue windows. */
	asr?: boolean;
}

function run(cmd: string, args: string[], timeout = 300_000): Promise<{ stdout: string; stderr: string }> {
	return new Promise((done, fail) => execFile(cmd, args, { timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => (error ? fail(new Error((stderr || error.message).toString().trim().split('\n').slice(-3).join(' '))) : done({ stdout: stdout.toString(), stderr: stderr.toString() }))));
}

interface Streams { video_s: number | null; audio_s: number | null; video_start: number | null; audio_start: number | null; duration_s: number }

async function probeStreams(file: string): Promise<Streams> {
	const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration:format=duration', '-of', 'json', file], 30_000);
	const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; start_time?: string; duration?: string }>; format?: { duration?: string } };
	const num = (v?: string) => { const n = Number(v); return v !== undefined && Number.isFinite(n) ? n : null; };
	const v = parsed.streams?.find((s) => s.codec_type === 'video');
	const a = parsed.streams?.find((s) => s.codec_type === 'audio');
	return { video_s: num(v?.duration), audio_s: num(a?.duration), video_start: num(v?.start_time), audio_start: num(a?.start_time), duration_s: num(parsed.format?.duration) ?? num(v?.duration) ?? 0 };
}

/** Check 1: one frame mid-entry plus the first and last second, tiled into a contact sheet. Near-black frames warn. */
async function pictureCheck(input: QcInput, streams: Streams, work: string): Promise<{ check: QcCheck; sheet?: string }> {
	const end = streams.video_s ?? streams.duration_s;
	const shots = [
		{ label: 'First second', at: Math.min(0.5, end / 2) },
		...input.entries.map((e) => ({ label: e.title, at: e.at_s + e.length_s / 2 })),
		{ label: 'Last second', at: Math.max(0, end - 0.5) }
	].filter((s) => s.at < end);
	const items: QcItem[] = [];
	let made = 0;
	for (const [i, shot] of shots.entries()) {
		try {
			await run('ffmpeg', ['-v', 'error', '-y', '-ss', shot.at.toFixed(3), '-i', input.file, '-frames:v', '1', '-vf', 'scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2', join(work, `f${String(made).padStart(3, '0')}.png`)], 60_000);
			const { stdout } = await new Promise<{ stdout: Buffer }>((done, fail) => execFile('ffmpeg', ['-v', 'error', '-i', join(work, `f${String(made).padStart(3, '0')}.png`), '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', windowsHide: true }, (error, out) => (error ? fail(error) : done({ stdout: out }))));
			made += 1;
			const mean = stdout.reduce((s, v) => s + v, 0) / Math.max(1, stdout.length);
			items.push(mean < 8
				? { status: 'warn', at_s: shot.at, message: `${shot.label}: the frame is black` }
				: { status: 'pass', at_s: shot.at, message: `${shot.label}` });
		} catch {
			items.push({ status: 'fail', at_s: shot.at, message: `${shot.label} (frame ${i + 1}): no picture could be read here` });
		}
	}
	let sheet: string | undefined;
	if (made) {
		const cols = Math.min(6, made);
		const rows = Math.ceil(made / cols);
		await mkdir(input.outDir, { recursive: true });
		const out = join(input.outDir, 'qc-sheet.jpg');
		try {
			await run('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', join(work, 'f%03d.png'), '-vf', `tile=${cols}x${rows}:padding=4:margin=4:color=0x101418`, '-frames:v', '1', '-q:v', '3', out], 60_000);
			sheet = input.sheetUrl ?? out;
		} catch { items.push({ status: 'warn', message: 'The contact sheet could not be tiled' }); }
	}
	const status = worst(items.map((i) => i.status));
	const black = items.filter((i) => i.status === 'warn' && i.message.endsWith('black')).length;
	return { check: { id: 'picture', label: 'Picture', status, summary: `${made} of ${shots.length} frames on the contact sheet${black ? `; ${black} black` : ''}`, items }, sheet };
}

/** Check 2's measurements: silences and loudness in one pass. */
async function measureSound(file: string, duration_s: number) {
	const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=n=${SILENCE_DB}dB:d=${SILENCE_MIN_S},ebur128=peak=true:framelog=quiet`, '-f', 'null', '-'], 600_000);
	return { silences: parseSilences(stderr, duration_s), ...parseLoudness(stderr) };
}

const seconds = (n: number) => Math.round(n * PCM_RATE);

/** Check 3: the song at each entry sits where the plan puts it; named sections land in an entry. */
async function songCheck(input: QcInput, cut: Float32Array | null): Promise<QcCheck | null> {
	if (!input.music) return null;
	const song = await readPcm(input.music.file).catch(() => null);
	const items: QcItem[] = [];
	if (!song || !cut) return { id: 'song', label: 'Song sync', status: 'warn', summary: 'The song or the cut audio could not be read', items: [{ status: 'warn', message: 'Song sync not measured' }] };
	const frame = 1 / input.fps;
	const window = 1.5;
	for (const entry of input.entries) {
		// The song plays from the cut's start: where the picture starts, the song should be at the plan's time for this entry.
		// With a music flow (head, quiet loops, ending), the song moment under this entry comes from its pieces.
		const want = songTimeAt(input.music.pieces, entry.planned_at_s);
		if (want === null) continue;
		const from = Math.max(0, want), to = Math.min(song.length / PCM_RATE, want + window);
		if (to - from < 0.3) continue;
		const needle = song.subarray(seconds(from), seconds(to));
		if (levelDb(needle) < -50) { items.push({ status: 'pass', at_s: entry.at_s, message: `${entry.title}: the song is silent here` }); continue; }
		// In the render, that song moment should sit at the entry's picture start.
		const lo = Math.max(0, entry.at_s + (from - want) - SEARCH_S);
		const hay = cut.subarray(seconds(lo), seconds(entry.at_s + (to - want) + SEARCH_S));
		const found = bestOffset(hay, needle);
		const offset = lo + found.offset / PCM_RATE - (entry.at_s + (from - want));
		items.push(offsetItem({ title: entry.title, at_s: entry.at_s, offset_s: offset, score: found.score, limit_s: frame, strict: true, what: `song at ${timecode(want)}` }));
	}
	// Named sections (Essentia): which entry each one lands in.
	let cursor = 0;
	for (const section of input.music.sections ?? []) {
		if (section.start <= 0) continue;
		while (cursor + 1 < input.entries.length && input.entries[cursor + 1].planned_at_s <= section.start) cursor += 1;
		const entry = input.entries[cursor];
		if (!entry || section.start > entry.planned_at_s + entry.length_s + 1) continue;
		items.push({ status: 'pass', at_s: section.start, message: `${section.label} at ${timecode(section.start)} lands in ${entry.title} (+${(section.start - entry.planned_at_s).toFixed(2)} s in)` });
	}
	const measured = items.filter((i) => !i.message.includes(' lands in '));
	const off = measured.filter((i) => i.status !== 'pass').length;
	return { id: 'song', label: 'Song sync', status: worst(items.map((i) => i.status)), summary: `${measured.length - off} of ${measured.length} entries on the song${off ? `; ${off} off or unsure` : ''}`, items };
}

/** Check 4: each entry's take sound sits on its picture; optional ASR against the written dialogue. */
async function lipSyncCheck(input: QcInput, cut: Float32Array | null, streams: Streams, work: string): Promise<QcCheck> {
	const items: QcItem[] = [];
	if (streams.video_start !== null && streams.audio_start !== null && Math.abs(streams.audio_start - streams.video_start) > LIP_SYNC_S)
		items.push({ status: 'fail', at_s: 0, message: `The audio stream starts ${Math.round((streams.audio_start - streams.video_start) * 1000)} ms from the picture` });
	if (input.take_muted) items.push({ status: 'warn', message: 'Take sound is muted in the mix; lip sync not measured' });
	const withTake = input.entries.filter((e) => e.take);
	if (!cut) items.push({ status: 'fail', message: 'The cut audio could not be read' });
	else if (!input.take_muted) for (const entry of withTake) {
		const take = await readPcm(entry.take!.file).catch(() => null);
		if (!take) continue; // a silent take: nothing to sync
		if (entry.ramped) { items.push({ status: entry.dialogue ? 'warn' : 'pass', at_s: entry.at_s, message: `${entry.title}: speed ramped; sync not measured` }); continue; }
		const edge = Math.min(input.crossfade_s + 0.05, entry.length_s / 4);
		const from = entry.take!.in_s + edge, to = entry.take!.in_s + entry.length_s - edge;
		const win = loudestWindow(take, PCM_RATE, from, Math.min(to, take.length / PCM_RATE), 1);
		if (win.db < -50 || to - from < 0.2) { items.push({ status: 'pass', at_s: entry.at_s, message: `${entry.title}: no take sound to sync` }); continue; }
		const needle = take.subarray(seconds(win.start), seconds(Math.min(win.start + 1, to)));
		const expected = entry.at_s + (win.start - entry.take!.in_s);
		const lo = Math.max(0, expected - SEARCH_S);
		const found = bestOffset(cut.subarray(seconds(lo), seconds(expected + needle.length / PCM_RATE + SEARCH_S)), needle);
		items.push(offsetItem({ title: entry.title, at_s: entry.at_s, offset_s: lo + found.offset / PCM_RATE - expected, score: found.score, limit_s: LIP_SYNC_S, strict: Boolean(entry.dialogue), what: entry.dialogue ? 'dialogue' : 'take sound' }));
	}
	if (input.asr && cut) items.push(...(await asrItems(input, work)));
	const measured = items.filter((i) => / (dialogue|take sound) [+−]/.test(i.message));
	const out = measured.filter((i) => i.status !== 'pass').length;
	const dialogue = input.entries.filter((e) => e.dialogue).length;
	return { id: 'lip_sync', label: 'Lip sync', status: worst(items.map((i) => i.status)), summary: `${measured.length} entr${measured.length === 1 ? 'y' : 'ies'} measured (${dialogue} with dialogue)${out ? `; ${out} off or unsure` : ''}`, items };
}

/** Local ASR (faster-whisper through uv) on each dialogue entry's stretch of the render; warns only. */
async function asrItems(input: QcInput, work: string): Promise<QcItem[]> {
	const spoken = input.entries.filter((e) => e.dialogue);
	if (!spoken.length) return [];
	const wavs: string[] = [];
	for (const [i, e] of spoken.entries()) {
		const wav = join(work, `asr-${i}.wav`);
		await run('ffmpeg', ['-v', 'error', '-y', '-ss', e.at_s.toFixed(3), '-t', e.length_s.toFixed(3), '-i', input.file, '-vn', '-ac', '1', '-ar', '16000', wav], 60_000);
		wavs.push(wav);
	}
	let heard: Array<{ text: string }>;
	try {
		const script = join(process.cwd(), 'scripts', 'qc_asr.py');
		const { stdout } = await run('uv', ['run', '--no-project', '--with', 'faster-whisper', 'python', script, ...wavs], 900_000);
		heard = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { text: string });
	} catch (cause) {
		return [{ status: 'warn', message: `ASR did not run: ${cause instanceof Error ? cause.message.slice(0, 200) : 'uv error'}` }];
	}
	return spoken.map((e, i) => {
		const text = heard[i]?.text ?? '';
		const match = dialogueMatch(e.dialogue!, text);
		return { status: match >= 0.5 ? 'pass' : 'warn', at_s: e.at_s, message: `${e.title}: heard "${text.slice(0, 120)}" (${Math.round(match * 100)}% of the written line)` } satisfies QcItem;
	});
}

/** Run the QC report on a rendered cut; writes qc-sheet.jpg and qc.json into outDir. Never throws for a bad render: that is a fail. */
export async function runQc(input: QcInput): Promise<QcReport> {
	const work = await mkdtemp(join(tmpdir(), 'csp-qc-'));
	try {
		const streams = await probeStreams(input.file);
		const picture = await pictureCheck(input, streams, work);
		const hasAudio = streams.audio_s !== null || streams.audio_start !== null;
		const sound = hasAudio ? await measureSound(input.file, streams.duration_s) : { silences: [], lufs: null, peak_db: null };
		const cut = hasAudio ? await readPcm(input.file).catch(() => null) : null;
		const checks: QcCheck[] = [
			picture.check,
			soundCheck({ has_audio: hasAudio, duration_s: streams.duration_s, ...sound })
		];
		const song = await songCheck(input, cut);
		if (song) checks.push(song);
		if (input.entries.length) checks.push(await lipSyncCheck(input, cut, streams, work));
		checks.push(lengthCheck({ video_s: streams.video_s, audio_s: streams.audio_s, planned_s: input.planned_s, fps: input.fps }));
		const report = finishReport({ at: new Date().toISOString(), file: input.label ?? input.file, duration_s: streams.duration_s, ...(picture.sheet ? { sheet: picture.sheet } : {}), checks });
		await mkdir(input.outDir, { recursive: true });
		await writeFile(join(input.outDir, 'qc.json'), JSON.stringify(report, null, 2), 'utf8');
		return report;
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'QC could not run';
		return finishReport({ at: new Date().toISOString(), file: input.label ?? input.file, duration_s: 0, checks: [{ id: 'length', label: 'Render readable', status: 'fail', summary: message.slice(0, 300), items: [{ status: 'fail', message: message.slice(0, 300) }] }] });
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}
