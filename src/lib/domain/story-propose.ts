import type { StoryPlan } from './story-plan';

/**
 * What the Agent may put into a story plan when it proposes a level (decision 3). One rule holds for all of them:
 * a proposal fills what is empty and never replaces or removes what is already there, so anything the operator
 * wrote, changed or approved stays exactly as it was. Everything arrives proposed; nothing here approves.
 */

type Section = StoryPlan['sections'][number];
export interface ProposedAct { title: string; summary: string }
export interface ProposedScene { act_id: string; title: string }
export interface ProposedBeat { scene_id: string; title: string; beat: string; duration_s: number; characters: string[]; location: string }
export interface ProposedShot { beat_id: string; title: string; beat: string; duration_s: number }

export type ProposeLevel = 'acts' | 'scenes' | 'beats' | 'shots';
type Outcome = { ok: true; plan: StoryPlan; added: number } | { ok: false; why: string };
const newId = () => crypto.randomUUID();

/** Why the Agent cannot propose a level yet; null when it can. */
export function proposeBlocked(plan: StoryPlan, level: ProposeLevel): string | null {
	const scenes = plan.sections.flatMap((section) => section.scenes);
	const beats = plan.sections.flatMap((section) => section.moments);
	if (level === 'acts') return scenes.length || beats.length ? 'The acts already hold scenes or story beats; change them by hand, or tell the Agent what to change' : null;
	if (level === 'scenes') return plan.sections.every((section) => section.scenes.length) ? 'Every act already has scenes' : null;
	if (level === 'beats') return !scenes.length ? 'Add or propose scenes first' : scenes.every((scene) => beats.some((beat) => beat.scene_id === scene.id)) ? 'Every scene already has story beats' : null;
	return !beats.length ? 'Add or propose story beats first' : beats.every((beat) => beat.shots.length) ? 'Every story beat already has shots' : null;
}

/** Acts replace the starting acts only while those hold nothing. */
export function applyProposedActs(plan: StoryPlan, acts: ProposedAct[]): Outcome {
	const blocked = proposeBlocked(plan, 'acts');
	if (blocked) return { ok: false, why: blocked };
	if (!acts.length) return { ok: false, why: 'No acts were proposed' };
	const sections: Section[] = acts.map((act) => ({ id: newId(), title: act.title, summary: act.summary, scenes: [], moments: [] }));
	return { ok: true, plan: { ...plan, sections }, added: sections.length };
}

/** Scenes go into acts that have none; an act that already has scenes is left alone. */
export function applyProposedScenes(plan: StoryPlan, scenes: ProposedScene[]): Outcome {
	const blocked = proposeBlocked(plan, 'scenes');
	if (blocked) return { ok: false, why: blocked };
	let added = 0;
	const sections = plan.sections.map((section) => {
		if (section.scenes.length) return section;
		const own = scenes.filter((scene) => scene.act_id === section.id).map((scene) => ({ id: newId(), title: scene.title }));
		added += own.length;
		return { ...section, scenes: own };
	});
	return added ? { ok: true, plan: { ...plan, sections }, added } : { ok: false, why: 'No scenes were proposed for the acts that have none' };
}

/** Story beats go into scenes that have none. */
export function applyProposedBeats(plan: StoryPlan, beats: ProposedBeat[]): Outcome {
	const blocked = proposeBlocked(plan, 'beats');
	if (blocked) return { ok: false, why: blocked };
	let added = 0;
	const sections = plan.sections.map((section) => {
		const empty = section.scenes.filter((scene) => !section.moments.some((moment) => moment.scene_id === scene.id));
		// Kept in scene order, so the act reads in the order it plays.
		const own = empty.flatMap((scene) => beats.filter((beat) => beat.scene_id === scene.id).map((beat) => ({ id: newId(), title: beat.title, beat: beat.beat, duration_s: beat.duration_s, characters: beat.characters, location: beat.location, scene_id: scene.id, approved: false, shots: [] })));
		added += own.length;
		return own.length ? { ...section, moments: [...section.moments, ...own] } : section;
	});
	return added ? { ok: true, plan: { ...plan, sections }, added } : { ok: false, why: 'No story beats were proposed for the scenes that have none' };
}

/** Shots go into story beats that have none. */
export function applyProposedShots(plan: StoryPlan, shots: ProposedShot[]): Outcome {
	const blocked = proposeBlocked(plan, 'shots');
	if (blocked) return { ok: false, why: blocked };
	let added = 0;
	const sections = plan.sections.map((section) => ({
		...section,
		moments: section.moments.map((moment) => {
			if (moment.shots.length) return moment;
			const own = shots.filter((shot) => shot.beat_id === moment.id).map((shot) => ({ id: newId(), title: shot.title, beat: shot.beat, duration_s: shot.duration_s }));
			added += own.length;
			return own.length ? { ...moment, shots: own } : moment;
		})
	}));
	return added ? { ok: true, plan: { ...plan, sections }, added } : { ok: false, why: 'No shots were proposed for the story beats that have none' };
}

/** Lengths that must add up to a total, nudged onto it when the Agent's sum is a little off (never by more than a tenth). */
export function fitDurations<T extends { duration_s: number }>(items: T[], total: number): T[] | null {
	const sum = items.reduce((all, item) => all + item.duration_s, 0);
	if (!items.length || sum <= 0 || Math.abs(sum - total) > total * 0.1) return null;
	const scaled = items.map((item) => ({ ...item, duration_s: Math.max(0.5, Math.round((item.duration_s * total) / sum * 2) / 2) }));
	// Whatever rounding left over goes on the longest item.
	const off = Math.round((total - scaled.reduce((all, item) => all + item.duration_s, 0)) * 1000) / 1000;
	const longest = scaled.reduce((best, item, i) => (item.duration_s > scaled[best].duration_s ? i : best), 0);
	scaled[longest] = { ...scaled[longest], duration_s: Math.round((scaled[longest].duration_s + off) * 1000) / 1000 };
	return scaled[longest].duration_s > 0 ? scaled : null;
}

/** "30s", "1:30", "2 min", "90 seconds" → seconds; the default when the brief gives no length that can be read. */
export function runtimeSeconds(runtime: string | undefined, fallback = 30): number {
	const text = (runtime ?? '').toLowerCase();
	const clock = /(\d+):(\d{2})/.exec(text);
	if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
	const minutes = /(\d+(?:\.\d+)?)\s*(?:m\b|min)/.exec(text);
	if (minutes) return Math.round(Number(minutes[1]) * 60);
	const seconds = /(\d+(?:\.\d+)?)\s*(?:s\b|sec)/.exec(text);
	return seconds ? Math.round(Number(seconds[1])) : fallback;
}
