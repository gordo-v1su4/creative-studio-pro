import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { CutMusic, Project } from '$lib/domain/schemas';
import { barLoudness, entriesFromPlan, shotsForAssembly, type AssemblyShot } from '$lib/domain/assemble';
import type { CutEntryInput } from '$lib/domain/cuts';
import { generateStructured, type AgentModelClient, type ModelImage } from './model-provider';
import { runFfmpeg } from './ffmpeg';

/** How many shots the Agent sees as pictures; any beyond are described in words only. */
export const MAX_FRAMES = 48;

const SYSTEM = `You are a trailer editor cutting a first assembly to a finished score. You see one frame from each shot (labelled S1, S2, … in the order given) and a map of the score: its length, tempo, beat count and how loud each bar is.
Choose the shots that tell the strongest story, put them in the order that plays best against the music, and say how many beats each one holds.
Editing rules: open on intrigue, build with the score, save the most striking images for the loudest bars and the hits, cut faster (1 to 2 beats) where the music drives and let shots breathe (4 to 8 beats) where it is quiet. Every cut lands on a beat. Use each shot at most once; leave weak, broken or repeated shots out. The cut must run the whole score, start to finish: the beats you give must add up to the score's beat count, so if you leave shots out, give the others more beats (a video shot can't hold longer than its footage).
After the music ends comes the end tag: one ident shot (the title card, or the strongest closing image if there is no title card) held 2 to 4 seconds over silence. Name it in end_tag and leave it out of the shots list.
Answer with JSON only.`;

const answer = z.object({
	name: z.string().trim().min(1).max(120),
	shots: z.array(z.object({ shot: z.number().int().positive(), beats: z.number().positive().max(64), why: z.string().max(300).optional() })).min(1).max(200),
	end_tag: z.object({ shot: z.number().int().positive(), seconds: z.number().positive().max(10) }).nullable().optional(),
	notes: z.string().max(1000).optional()
});

export interface AssemblyDeps {
	/** A small JPEG of the shot's take (the middle of its kept span), or null when it can't be read. */
	frame: (shot: AssemblyShot) => Promise<ModelImage | null>;
	/** The score as mono PCM, or null when it can't be decoded. */
	pcm: () => Promise<{ samples: Float32Array; rate: number } | null>;
}

export interface Assembly { name: string; entries: CutEntryInput[]; notes: string[] }

/** The Agent's first cut of the project's shots to its score. Null when there is nothing to cut. */
export async function assembleFirstCut(client: AgentModelClient, project: Project, score: CutMusic, deps: AssemblyDeps): Promise<Assembly | null> {
	const shots = shotsForAssembly(project.production);
	if (shots.length === 0) return null;
	const images: ModelImage[] = [];
	const seen: number[] = [];
	for (const shot of shots.slice(0, MAX_FRAMES)) {
		const image = await deps.frame(shot);
		if (image) { images.push(image); seen.push(shot.n); }
	}
	const pcm = await deps.pcm();
	const bars = pcm ? barLoudness(pcm.samples, pcm.rate, score) : [];
	const beatCount = score.beats.length || Math.round(score.duration_s * 2);
	const shotLines = shots.map((shot) => `S${shot.n}${seen.includes(shot.n) ? ` (picture ${seen.indexOf(shot.n) + 1})` : ''} · ${shot.kind === 'video' ? `video, ${shot.max_s.toFixed(1)}s of footage` : 'still'} · ${shot.title}${shot.beat ? ` · ${shot.beat.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
	const ask = [
		`SCORE: ${score.name}, ${score.duration_s.toFixed(1)}s, ${score.bpm ? `${score.bpm} BPM, ` : ''}${beatCount} beats (a beat is about ${(score.duration_s / Math.max(1, beatCount)).toFixed(2)}s).`,
		bars.length ? `LOUDNESS BY BAR (time in seconds: 0 quiet to 9 loudest):\n${bars.map((bar) => `${bar.at.toFixed(1)}:${bar.level}`).join(' ')}` : '',
		`SHOTS (${shots.length}; the pictures are in this order, one per shot that has one):\n${shotLines.join('\n')}`,
		`PROJECT: ${project.title}${project.production.logline ? `. ${project.production.logline}` : ''}`,
		`Answer with only JSON: {"name":"a short name for this cut","shots":[{"shot":3,"beats":8,"why":"a few words"}],"end_tag":{"shot":12,"seconds":3},"notes":"one or two lines on the shape of the cut"}. The shots' beats add up to ${beatCount}. A video shot can't hold longer than its footage.`
	].filter(Boolean).join('\n\n');
	const budget = { system: SYSTEM, images, maxOutputTokens: 4000, timeoutMs: 300_000 };
	let plan = await generateStructured(client, { ...budget, prompt: ask }, (value) => answer.parse(value));
	let laid = entriesFromPlan(plan.shots, shots, score, plan.end_tag);
	// Short of the score (shots left out, or footage that ran out): one more pass, told exactly where it fell short.
	if (laid.covered_s < score.duration_s - 1) {
		const short = `${ask}\n\nYour plan:\n${JSON.stringify(plan)}\n\nLaid on the beats it covers only ${laid.covered_s.toFixed(1)}s of the ${score.duration_s.toFixed(1)}s score (${laid.notes.join('; ') || 'too few beats'}). Give the whole plan again so it runs to the end of the score: add shots or give shots more beats, within their footage.`;
		const retry = await generateStructured(client, { ...budget, prompt: short }, (value) => answer.parse(value));
		const relaid = entriesFromPlan(retry.shots, shots, score, retry.end_tag);
		if (relaid.covered_s > laid.covered_s) { plan = retry; laid = relaid; }
	}
	if (laid.entries.length === 0) throw new Error('The Agent placed no usable shots');
	return { name: plan.name, entries: laid.entries, notes: [plan.notes ?? '', ...laid.notes].filter(Boolean) };
}

/** A 512px JPEG of a local image or video file (for a video, the frame at `at` seconds). */
export async function frameOf(file: string, at: number | null): Promise<ModelImage | null> {
	const dir = await mkdtemp(join(tmpdir(), 'csp-frame-'));
	const out = join(dir, 'frame.jpg');
	try {
		await runFfmpeg(['-y', ...(at !== null ? ['-ss', at.toFixed(2)] : []), '-i', file, '-frames:v', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease', '-q:v', '5', out], 60_000);
		return { data: new Uint8Array(await readFile(out)), mediaType: 'image/jpeg' };
	} catch {
		return null;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
