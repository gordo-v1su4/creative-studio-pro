import type { Project, StoryCard } from '$lib/domain/schemas';
import { clockOf, type EpisodeOutline } from '$lib/domain/episode-outline';
import type { FitScene } from '$lib/domain/episode-fit';
import type { HandleReference } from '$lib/domain/handles';
import { lintTeaser, redactAll } from '$lib/server/trailer-house';

/**
 * Fit to length, what the Agent reads for one scene: the season story, the episode, the scene's Action,
 * Dialogue, story beats and References, its shots so far and the next scene, banned words blacked out.
 * Since V1S-375 the writing itself is Ghost's (`ghost-shots.ts`): shot specs first, prompts after approval.
 * Fit only writes text: it never sends anything to an image or video model.
 */

/** Every banned word the linter finds in a text (built-in bans and the project's), for blacking out. */
const bannedIn = (text: string, banned: string[]) => lintTeaser(text, banned).filter((issue) => issue.rule === 'banned-word' || issue.rule === 'project-rule').map((issue) => issue.match);

export interface FitContext {
	story: string;
	series: NonNullable<Project['series']>;
	outline: EpisodeOutline;
	target_min: number;
	scene: FitScene;
	/** The scene's beats now on the board, in order. */
	sceneCards: StoryCard[];
	/** The scene after this one, so the new shots lead into it. */
	nextScene: { title: string; summary: string } | null;
	banned: string[];
	/** V1S-329: the season story beats this scene carries (title + summary). */
	storyBeats?: Array<{ title: string; section: string; summary: string }>;
	/** V1S-329: the scene's references (exact names, handles, kinds). */
	references?: Array<HandleReference & { role: string }>;
	/** Exact reference name → its ONE SHOT hand-off line (CHARACTER … / LOCATION …), from Prep. */
	handOffs?: Record<string, string>;
	/** Every reference in the series, for compiling handles (defaults to the scene's). */
	allReferences?: HandleReference[];
}

/** A shot's spoken lines: Notion's, else its spec's, else Fit's. */
const dialogueOf = (card: StoryCard) => card.source?.dialogue ?? card.fit?.spec?.dialogue ?? card.fit?.dialogue ?? '';

/** What the Agent reads for one scene. Banned words are blacked out everywhere in it. */
export function fitContext(input: FitContext): string {
	const row = input.outline.acts.flatMap((act) => act.scenes).find((scene) => scene.page_id === input.scene.page_id)!;
	const scene = input.series.scenes.find((entry) => entry.page_id === input.scene.page_id)!;
	const detail = (card: StoryCard) => {
		// A Fit shot keeps its details in `fit`; once synced it also has a `source` (its Notion link), so merge field by field.
		const extra = { dialogue: dialogueOf(card), audio: card.source?.audio ?? card.fit?.audio, refs: card.source?.refs ?? card.fit?.refs };
		const pending = card.fit?.spec && !card.fit.approved_at;
		return [
			`- ${card.title} (${Math.round(card.duration_ms / 1000)} s): ${card.beat}`,
			extra.dialogue ? `  Dialogue: ${extra.dialogue}` : '',
			extra.audio ? `  Audio: ${extra.audio}` : '',
			extra.refs ? `  Refs: ${extra.refs}` : '',
			pending ? '' : `  Video prompt: ${card.video_prompt}`
		].filter(Boolean).join('\n');
	};
	const beats = (input.storyBeats ?? []).map((beat) => `- ${beat.title}${beat.section ? ` (${beat.section})` : ''}: ${beat.summary || '—'}`).join('\n');
	const refs = (input.references ?? []).map((ref) => `- ${ref.handles.join(' ') || '(no handle)'} → ${ref.name} (${ref.kind || 'reference'})${ref.role ? ` — ${ref.role}` : ''}${input.handOffs?.[ref.name] ? `\n  ${input.handOffs[ref.name]}` : ''}`).join('\n');
	const text = [
		input.story ? `THE SEASON STORY (the bible: never contradict it, never reveal its secrets early):\n${input.story}` : '',
		`THIS EPISODE: ${input.series.episode_title}\n${input.series.summary}${input.series.twist ? `\nMid-episode twist: ${input.series.twist}` : ''}${input.series.cliffhanger ? `\nCliffhanger: ${input.series.cliffhanger}` : ''}`,
		`THE EPISODE'S SCENES IN ORDER, shots now against each scene's budget at ${input.target_min} min:\n${input.outline.acts.flatMap((act) => act.scenes.map((s) => `- ${s.title} [${act.act}] ${clockOf(s.shot_s)} of ${clockOf(s.target_s)}`)).join('\n')}`,
		`THE SCENE TO FILL: ${row.title} (${row.act})\nLocation: ${row.location || '—'}\nCharacters: ${row.characters.join(', ') || '—'}\nSummary: ${scene.summary || '—'}`,
		`ACTION (what happens, in order; cover all of it):\n${scene.story_beats || '—'}`,
		`DIALOGUE (the script: every line goes in exactly one shot, verbatim, in this order):\n${scene.dialogue?.trim() || '(none: no one speaks in this scene)'}`,
		`SEASON STORY BEATS THIS SCENE CARRIES (show each one on screen):\n${beats || '(none linked)'}`,
		`REFERENCES (use only these, by @handle; the app writes the exact name and attaches the image; a CHARACTER / LOCATION line under one is how that reference is described, use it as given and never re-describe it):\n${refs || '(none: give everyone an exact, fixed name)'}`,
		`ITS SHOTS SO FAR, IN ORDER (they stay; yours play after the last one):\n${input.sceneCards.map(detail).join('\n') || '(none yet)'}`,
		input.nextScene ? `THE NEXT SCENE (your last shot leads into it): ${input.nextScene.title}: ${input.nextScene.summary}` : 'This is the episode\'s last scene.'
	].filter(Boolean).join('\n\n');
	return redactAll(text, bannedIn(text, input.banned));
}

/** The answer budget for writing a scene's shots: a 10-shot scene needs more room and time than a 4-shot one. */
export const sceneBudget = (shots: number) => ({
	maxOutputTokens: Math.min(16_000, Math.max(8000, shots * 1200)),
	timeoutMs: Math.min(600_000, Math.max(180_000, shots * 45_000))
});
