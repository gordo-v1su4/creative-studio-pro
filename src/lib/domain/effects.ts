/**
 * Agent effects pass (V1S-129). Measurable work in code: which files in the
 * local sound-effects folder are effects (hits, whooshes, risers) and where
 * the moments are (every cut, and impacts in the take audio). The Agent
 * makes the judgment call: which sound goes on which moment, or that one
 * should be generated. Its answer is checked against the moments and the
 * index before anything is placed, and lands as suggestions only.
 */

export type EffectKind = 'hit' | 'whoosh' | 'riser';

export interface SfxFile {
	/** Path inside the effects folder, with forward slashes: the id the Agent answers with. */
	id: string;
	name: string;
	kind: EffectKind;
}

const KIND_WORDS: Array<[EffectKind, RegExp]> = [
	['riser', /\b(riser|risers|rise|uplift(er)?|swell|build ?up|reverse ?cymbal|tension)\b/i],
	['whoosh', /\b(whoosh|swoosh|swish|woosh|sweep|swipe|pass ?by|fly ?by|transition|downlift(er)?|down ?sweep)\b/i],
	['hit', /\b(hit|hits|impact|impactful|boom|slam|punch|thud|braam|crash|smash|sub ?drop|downer)\b/i]
];
/** Musical material, not effects: loops, drums, notes and vocals are left out of the index. */
const NOT_EFFECTS = /\b(loop|loops|drum|drums|kick|snare|hat|hihat|clap|perc|bass|chord|chords|melody|melodic|vocal|vox|acapella|keys|piano|pad|lead|arp|synth ?loop|top ?loop|groove|fill)\b/i;
export const AUDIO_FILE = /\.(wav|mp3|aif|aiff|flac|ogg|m4a)$/i;

/** An effect's kind from its path (folder and file name), or null when it isn't an effect. */
export function classifyEffect(path: string): EffectKind | null {
	if (!AUDIO_FILE.test(path)) return null;
	const words = path.replace(/\.[^.]+$/, '').replace(/[_\-./\\()[\]#]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
	if (NOT_EFFECTS.test(words)) return null;
	for (const [kind, pattern] of KIND_WORDS) if (pattern.test(words)) return kind;
	return null;
}

export interface Moment {
	at_s: number;
	kind: 'cut' | 'impact';
	/** For a cut: the beats either side. */
	note: string;
}

/** Every cut in the cut (between entries), with the entries' titles. */
export function cutMoments(entries: Array<{ title: string; length_s: number }>): Moment[] {
	const moments: Moment[] = [];
	let at = 0;
	entries.forEach((entry, i) => {
		at += entry.length_s;
		if (i < entries.length - 1) moments.push({ at_s: Math.round(at * 1000) / 1000, kind: 'cut', note: `${entry.title} → ${entries[i + 1].title}` });
	});
	return moments;
}

/** Impacts in the take audio: the level jumps ≥ 10 dB above the previous 100 ms and lands above −25 dBFS. At most one per half second. */
export function impactMoments(activityDb: number[], hz: number): Moment[] {
	const out: Moment[] = [];
	const window = Math.round(0.1 * hz);
	for (let f = window; f < activityDb.length; f++) {
		const before = Math.max(...activityDb.slice(f - window, f));
		if (activityDb[f] < -25 || activityDb[f] - before < 10) continue;
		const at = Math.round((f / hz) * 1000) / 1000;
		if (out.length && at - out.at(-1)!.at_s < 0.5) continue;
		out.push({ at_s: at, kind: 'impact', note: `${Math.round(activityDb[f] - before)} dB jump in the take audio` });
	}
	return out;
}

export interface ProposedEffect {
	/** When the effect starts in the cut. */
	at_s: number;
	/** How far into the file it starts (a riser longer than the time before its moment). */
	from_s?: number;
	moment_s: number;
	sfx_id: string;
	reason: string;
}

export interface GenerateOffer {
	moment_s: number;
	prompt: string;
	duration_s: number;
	/** Start time, so a riser ends on its moment. */
	at_s: number;
	reason: string;
}

/**
 * Check the Agent's answer. Each placement must name a moment that exists
 * and a file in the index; a riser is moved so it ends on its moment.
 * "generate" picks become offers the operator approves (and pays for) first.
 */
export function checkProposals(answer: unknown, moments: Moment[], index: SfxFile[], durations: Record<string, number>): { placed: ProposedEffect[]; offers: GenerateOffer[]; dropped: string[] } {
	const items = (answer as { effects?: unknown })?.effects;
	if (!Array.isArray(items)) throw new Error('effects must be an array');
	const byId = new Map(index.map((file) => [file.id, file]));
	const placed: ProposedEffect[] = [];
	const offers: GenerateOffer[] = [];
	const dropped: string[] = [];
	for (const raw of items.slice(0, 40)) {
		const item = raw as { moment_s?: unknown; sfx_id?: unknown; generate?: unknown; duration_s?: unknown; reason?: unknown };
		const momentAt = Number(item.moment_s);
		const moment = moments.find((m) => Math.abs(m.at_s - momentAt) <= 0.05);
		const reason = typeof item.reason === 'string' ? item.reason.slice(0, 200) : '';
		if (!moment) { dropped.push(`no moment at ${item.moment_s}s`); continue; }
		if (typeof item.generate === 'string' && item.generate.trim()) {
			const duration = Math.min(5, Math.max(0.5, Number(item.duration_s) || 1));
			const riser = /\b(riser|rise|swell|build)\b/i.test(item.generate);
			offers.push({ moment_s: moment.at_s, prompt: item.generate.trim().slice(0, 300), duration_s: duration, at_s: Math.max(0, Math.round((riser ? moment.at_s - duration : moment.at_s) * 1000) / 1000), reason });
			continue;
		}
		const file = typeof item.sfx_id === 'string' ? byId.get(item.sfx_id) : undefined;
		if (!file) { dropped.push(`not in the effects folder: ${String(item.sfx_id)}`); continue; }
		const length = durations[file.id] ?? 1;
		const at = file.kind === 'riser' ? moment.at_s - length : file.kind === 'whoosh' ? moment.at_s - Math.min(0.3, length / 2) : moment.at_s;
		if (placed.some((p) => p.moment_s === moment.at_s && p.sfx_id === file.id)) continue;
		// Before the cut starts there's no room for all of it: start into the file so it still ends on the moment.
		const from = at < 0 ? Math.round(-at * 1000) / 1000 : 0;
		placed.push({ at_s: Math.max(0, Math.round(at * 1000) / 1000), ...(from ? { from_s: from } : {}), moment_s: moment.at_s, sfx_id: file.id, reason });
	}
	return { placed, offers, dropped };
}
