import { z } from 'zod';
import type { ProductionState, Project, StoryCard } from './schemas';
import { CODE_PATTERN, SHOT_MAX, SHOT_STEP, shotNumberText, suggestCode } from './shot-codes';
import { appendPlannedShots, boardCardFor, sceneGroupId, type PlanScene } from './story-plan';

/**
 * The story plan's five levels (CONTEXT.md: Story plan) and the names each one fixes (decision 22, ADR 0010).
 * The Agent proposes a level, the operator approves it, and approving it gives that level's things their codes
 * once: the show and project code with the brief, a scene code with each scene, a shot code with each shot.
 * A code never changes after that; a title always can.
 */

export const STORY_LEVELS = ['brief', 'acts', 'scenes', 'beats', 'shots'] as const;
export type StoryLevel = (typeof STORY_LEVELS)[number];
export type LevelState = 'empty' | 'proposed' | 'approved';
export type LevelStates = Record<StoryLevel, LevelState>;
export type LevelCounts = Record<StoryLevel, number>;
/** When each level was approved. */
export type LevelApprovals = Partial<Record<StoryLevel, string>>;

export const PROJECT_CODE_PATTERN = /^(TR|EP)\d{3}$/;

/** Stored on the production. Only approving a level writes it; a whole-production save keeps what is stored. */
export const storyLevelsSchema = z.object({
	approved: z.object({ brief: z.string().optional(), acts: z.string().optional(), scenes: z.string().optional(), beats: z.string().optional(), shots: z.string().optional() }).default({}),
	/** Fixed with the brief: three capitals for the show, and the trailer or episode code (TR100, EP101). */
	show_code: z.string().regex(CODE_PATTERN).optional(),
	project_code: z.string().regex(PROJECT_CODE_PATTERN).optional()
});
export type StoryLevels = z.infer<typeof storyLevelsSchema>;

const WORDS: Record<StoryLevel, { label: string; the: string; is: string; things: string; fixes: string | null }> = {
	brief: { label: 'Brief', the: 'the brief', is: 'is', things: 'brief', fixes: 'the show code and the project code' },
	acts: { label: 'Acts', the: 'the acts', is: 'are', things: 'acts', fixes: null },
	scenes: { label: 'Scenes', the: 'the scenes', is: 'are', things: 'scenes', fixes: 'each scene code' },
	beats: { label: 'Story beats', the: 'the story beats', is: 'are', things: 'story beats', fixes: null },
	shots: { label: 'Shot list', the: 'the shot list', is: 'is', things: 'shots', fixes: 'each shot code' }
};
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

export const levelLabel = (level: StoryLevel) => WORDS[level].label;
/** "the scenes", "the shot list": the level as it reads inside a sentence. */
export const levelPhrase = (level: StoryLevel) => WORDS[level].the;

/** `open` is how many things in a level still wait (added since it was approved): they put it back to proposed. */
export function levelStates(counts: LevelCounts, approvals: LevelApprovals, open: Partial<LevelCounts> = {}): LevelStates {
	const state = (level: StoryLevel): LevelState => counts[level] === 0 ? 'empty' : approvals[level] && !open[level] ? 'approved' : 'proposed';
	return { brief: state('brief'), acts: state('acts'), scenes: state('scenes'), beats: state('beats'), shots: state('shots') };
}

export function nextLevel(states: LevelStates): StoryLevel | null {
	return STORY_LEVELS.find((level) => states[level] !== 'approved') ?? null;
}

export function canApprove(level: StoryLevel, states: LevelStates): { ok: true } | { ok: false; why: string } {
	const words = WORDS[level];
	if (states[level] === 'approved') return { ok: false, why: `${capital(words.the)} ${words.is} already approved` };
	const earlier = STORY_LEVELS.slice(0, STORY_LEVELS.indexOf(level)).find((entry) => states[entry] !== 'approved');
	if (earlier) return { ok: false, why: `Approve ${WORDS[earlier].the} first` };
	if (states[level] === 'empty') return { ok: false, why: level === 'brief' ? 'There is no brief to approve yet' : `There are no ${words.things} to approve yet` };
	return { ok: true };
}

/** Shown before a level is approved (story 16): which names approving it fixes. */
export function lockNotice(level: StoryLevel): string {
	const { the, fixes } = WORDS[level];
	return fixes ? `Approving ${the} fixes ${fixes}. Titles can still change.` : `Approving ${the} fixes no names.`;
}

// --- Codes ----------------------------------------------------------------------------------------------------

/** Three capitals from a scene's title that no other scene has (the rule show codes already follow). */
export const sceneCodeFor = (title: string, taken: Iterable<string>) => suggestCode(title, taken);

/** A code for every scene without one. A code already given is never touched; `alsoTaken` are codes in use elsewhere. */
export function assignSceneCodes<S extends { id: string; title: string; scene_code?: string }>(scenes: S[], alsoTaken: Iterable<string> = []): Array<S & { scene_code: string }> {
	const taken = new Set([...alsoTaken, ...scenes.flatMap((scene) => (scene.scene_code ? [scene.scene_code] : []))]);
	return scenes.map((scene) => {
		if (scene.scene_code) return { ...scene, scene_code: scene.scene_code };
		const scene_code = sceneCodeFor(scene.title, taken);
		taken.add(scene_code);
		return { ...scene, scene_code };
	});
}

const nextStep = (n: number) => Math.floor(n / SHOT_STEP) * SHOT_STEP + SHOT_STEP;

/**
 * Shot numbers within each scene, for shots given in story order: tens from 0010, a shot between two numbered
 * ones takes a number between them, and with no room left it goes after the scene's last number. A number already
 * given is kept, and one a scene ever gave (`taken`: a shot since removed or moved away) is never given again.
 */
export function assignShotNumbers(shots: Array<{ id: string; scene: string; number?: number }>, taken: Record<string, number[]> = {}): Record<string, number> {
	const result: Record<string, number> = {};
	for (const scene of new Set(shots.map((shot) => shot.scene))) {
		const own = shots.filter((shot) => shot.scene === scene);
		const used = new Set([...(taken[scene] ?? []), ...own.flatMap((shot) => (shot.number === undefined ? [] : [shot.number]))]);
		let last = 0;
		for (const [at, shot] of own.entries()) {
			if (shot.number !== undefined) { result[shot.id] = shot.number; last = shot.number; continue; }
			const after = own.slice(at + 1).find((later) => later.number !== undefined)?.number;
			let number: number | null = null;
			if (after !== undefined && after > last) {
				// Numbers once given between the two neighbours stay behind this shot.
				const floor = Math.max(last, ...[...used].filter((n) => n > last && n < after));
				const mid = Math.floor((floor + after) / 2);
				if (mid > floor && mid < after) number = mid;
			}
			number ??= nextStep(Math.max(last, ...used));
			if (number > SHOT_MAX) throw new Error(`No free shot number left in scene ${scene}`);
			used.add(number); result[shot.id] = number; last = number;
		}
	}
	return result;
}

/** The names a project holds, as the lock compares them. An id maps to null when the thing exists but has no code yet. */
export interface PlanNames { show: string | null; project: string | null; scenes: Record<string, string | null>; shots: Record<string, string | null> }

/**
 * What a change may not do to names once their level is approved: a fixed code cannot change, cannot be taken
 * away, and cannot be handed to something else when its owner is removed. New things can always be added.
 */
export function lockViolations(approvals: LevelApprovals, before: PlanNames, after: PlanNames): string[] {
	const out: string[] = [];
	if (approvals.brief) {
		if (before.show && after.show !== before.show) out.push(`The show code is fixed at ${before.show}`);
		if (before.project && after.project !== before.project) out.push(`The project code is fixed at ${before.project}`);
	}
	const fixed = (word: string, was: Record<string, string | null>, now: Record<string, string | null>) => {
		for (const [id, code] of Object.entries(was)) {
			if (!code) continue;
			if (id in now) { if (now[id] !== code) out.push(`${capital(word)} code ${code} is fixed`); continue; }
			if (Object.entries(now).some(([other, given]) => given === code && was[other] !== code)) out.push(`${capital(word)} code ${code} belongs to another ${word} and cannot be given again`);
		}
	};
	if (approvals.scenes) fixed('scene', before.scenes, after.scenes);
	if (approvals.shots) fixed('shot', before.shots, after.shots);
	return out;
}

// --- On a project ---------------------------------------------------------------------------------------------

const planScenes = (production: ProductionState): PlanScene[] => production.story_plan?.sections.flatMap((section) => section.scenes) ?? [];
const planMoments = (production: ProductionState) => production.story_plan?.sections.flatMap((section) => section.moments) ?? [];
const approvalsOf = (project: Project): LevelApprovals => project.production.story_levels?.approved ?? {};

/** A scene's code: Review Room's for its board group when it has one there (that never changes), else the plan's. */
const codeOfScene = (project: Project, scene: PlanScene) => project.review_room?.scenes?.[sceneGroupId(scene)]?.code ?? scene.scene_code ?? null;

/** Board groups that are scenes, with their codes: the story plan's coded scenes and Review Room's scene folders. */
function codedGroups(project: Project): Map<string, string> {
	const groups = new Map<string, string>();
	for (const scene of planScenes(project.production)) { const code = codeOfScene(project, scene); if (code) groups.set(sceneGroupId(scene), code); }
	for (const [groupId, scene] of Object.entries(project.review_room?.scenes ?? {})) groups.set(groupId, scene.code);
	for (const scene of project.series?.scenes ?? []) if (scene.code) groups.set(scene.group_id, scene.code);
	return groups;
}

/** The scene code of a board group; null for a group that is not a scene (its shots are unplaced). */
export const sceneCodeOfGroup = (project: Project, groupId: string): string | null => codedGroups(project).get(groupId) ?? null;

const SHORT = /_([A-Z]{3})_(\d{4})$/;
/** `VHS_0010`: the scene code and shot number a shot was given. Review Room's name for it wins; it is the same one. */
export function shortCodeOf(project: Project, card: Pick<StoryCard, 'card_id' | 'scene_code' | 'shot_number'>): string | null {
	const stored = SHORT.exec(project.review_room?.shots[card.card_id]?.code ?? '');
	if (stored) return `${stored[1]}_${stored[2]}`;
	return card.scene_code && card.shot_number ? `${card.scene_code}_${shotNumberText(card.shot_number)}` : null;
}

/** The show and project codes: fixed with the brief, else the ones Review Room already uses for this project. */
export function projectCodes(project: Project): { show: string | null; project: string | null } {
	const levels = project.production.story_levels;
	return { show: levels?.show_code ?? project.review_room?.show_code ?? null, project: levels?.project_code ?? project.review_room?.code ?? null };
}

/** `BLR_TR100_VHS_0010`: a shot's whole code, once the brief and the shot list have fixed its parts. */
export function shotCodeOf(project: Project, card: Pick<StoryCard, 'card_id' | 'scene_code' | 'shot_number'>): string | null {
	const stored = project.review_room?.shots[card.card_id]?.code;
	if (stored) return stored;
	const short = shortCodeOf(project, card);
	const { show, project: code } = projectCodes(project);
	return short && show && code ? `${show}_${code}_${short}` : null;
}

export function planNames(project: Project): PlanNames {
	return {
		...projectCodes(project),
		scenes: Object.fromEntries(planScenes(project.production).map((scene) => [scene.id, codeOfScene(project, scene)])),
		shots: Object.fromEntries(project.production.cards.map((card) => [card.card_id, shortCodeOf(project, card)]))
	};
}

/** Planned shots that have no card on the board yet. */
const unlisted = (production: ProductionState) => planMoments(production).flatMap((moment) => moment.shots).filter((shot) => !boardCardFor(production, shot));

export function levelCounts(project: Project): LevelCounts {
	const { production } = project;
	return {
		brief: project.brief_state.versions.length ? 1 : 0,
		acts: production.story_plan?.sections.length ?? 0,
		scenes: planScenes(production).length,
		beats: planMoments(production).length,
		shots: production.cards.length + unlisted(production).length
	};
}

/** What still waits in each level: scenes with no code, story beats not approved, shots with no shot code. */
export function levelOpen(project: Project): Partial<LevelCounts> {
	const { production } = project;
	const groups = codedGroups(project);
	return {
		scenes: planScenes(production).filter((scene) => !codeOfScene(project, scene)).length,
		beats: planMoments(production).filter((moment) => !moment.approved).length,
		shots: unlisted(production).length + production.cards.filter((card) => card.group_id && groups.has(card.group_id) && !shortCodeOf(project, card)).length
	};
}

export const levelsOf = (project: Project): LevelStates => levelStates(levelCounts(project), approvalsOf(project), levelOpen(project));

/** Give every shot in a scene that has no shot code its code; a shot that has one (here or in Review Room) keeps it. */
function nameShots(project: Project): StoryCard[] {
	const groups = codedGroups(project);
	// Review Room's name for a shot is the shot's name here too.
	const cards = project.production.cards.map((card) => {
		const stored = SHORT.exec(project.review_room?.shots[card.card_id]?.code ?? '');
		return stored && !(card.scene_code && card.shot_number) ? { ...card, scene_code: stored[1], shot_number: Number(stored[2]) } : card;
	});
	const taken: Record<string, number[]> = {};
	const give = (scene: string, number: number) => { (taken[scene] ??= []).push(number); };
	for (const card of cards) if (card.scene_code && card.shot_number) give(card.scene_code, card.shot_number);
	for (const shot of Object.values(project.review_room?.shots ?? {})) { const stored = SHORT.exec(shot.code); if (stored) give(stored[1], Number(stored[2])); }
	// A shot that came from another scene keeps that scene's code, so it takes no number in this one.
	const inOrder = cards.filter((card) => { const scene = card.group_id && groups.get(card.group_id); return scene && (!card.scene_code || card.scene_code === scene); }).toSorted((a, b) => a.order - b.order);
	const numbers = assignShotNumbers(inOrder.map((card) => ({ id: card.card_id, scene: groups.get(card.group_id!)!, number: card.shot_number })), taken);
	return cards.map((card) => (card.shot_number === undefined && numbers[card.card_id] !== undefined ? { ...card, scene_code: groups.get(card.group_id!)!, shot_number: numbers[card.card_id] } : card));
}

/**
 * Approve a level: record it and give its things their codes, once. Approving again later names only what was
 * added since. Throws with the reason when the level cannot be approved yet.
 */
export function applyLevelApproval(project: Project, level: StoryLevel, now: string, input: { show_code?: string; project_code?: string } = {}): Project {
	const allowed = canApprove(level, levelsOf(project));
	if (!allowed.ok) throw new Error(allowed.why);
	const levels: StoryLevels = { ...project.production.story_levels, approved: { ...approvalsOf(project), [level]: now } };
	let production = project.production;
	if (level === 'brief') {
		const room = project.review_room;
		const show = input.show_code ?? levels.show_code ?? room?.show_code ?? suggestCode(project.brief_state.versions.at(-1)?.title ?? project.title);
		const code = input.project_code ?? levels.project_code ?? room?.code ?? 'TR100';
		if (!CODE_PATTERN.test(show)) throw new Error('A show code is three capital letters');
		if (!PROJECT_CODE_PATTERN.test(code)) throw new Error('A project code is TR or EP and three digits, like TR100');
		if (room && (room.show_code !== show || room.code !== code)) throw new Error(`Review Room already knows this project as ${room.show_code} ${room.code}`);
		levels.show_code = show; levels.project_code = code;
	}
	if (level === 'scenes' && production.story_plan) {
		const stored = Object.values(project.review_room?.scenes ?? {}).map((scene) => scene.code);
		const known = planScenes(production).map((scene) => ({ ...scene, scene_code: codeOfScene(project, scene) ?? undefined }));
		const coded = new Map(assignSceneCodes(known, stored).map((scene) => [scene.id, scene.scene_code]));
		production = { ...production, story_plan: { ...production.story_plan, sections: production.story_plan.sections.map((section) => ({ ...section, scenes: section.scenes.map((scene) => ({ ...scene, scene_code: coded.get(scene.id) })) })) } };
	}
	if (level === 'beats' && production.story_plan) {
		production = { ...production, story_plan: { ...production.story_plan, sections: production.story_plan.sections.map((section) => ({ ...section, moments: section.moments.map((moment) => ({ ...moment, approved: true })) })) } };
	}
	if (level === 'shots') {
		production = appendPlannedShots(production, now);
		production = { ...production, cards: nameShots({ ...project, production }) };
	}
	return { ...project, production: { ...production, story_levels: levels } };
}

/**
 * A whole-production save keeps what only an approval may write: the approvals themselves, and any fixed code the
 * incoming copy simply does not carry (a draft made before the approval). A code that comes back different is
 * left as sent, for the lock to refuse.
 */
export function keepFixedNames(stored: ProductionState, incoming: ProductionState): ProductionState {
	const approved = stored.story_levels?.approved ?? {};
	let next: ProductionState = { ...incoming, story_levels: stored.story_levels };
	if (approved.shots) {
		const had = new Map(stored.cards.map((card) => [card.card_id, card]));
		next = { ...next, cards: next.cards.map((card) => { const was = had.get(card.card_id); return was ? { ...card, scene_code: card.scene_code ?? was.scene_code, shot_number: card.shot_number ?? was.shot_number } : card; }) };
	}
	if (approved.scenes && next.story_plan) {
		const had = new Map(planScenes(stored).map((scene) => [scene.id, scene.scene_code]));
		next = { ...next, story_plan: { ...next.story_plan, sections: next.story_plan.sections.map((section) => ({ ...section, scenes: section.scenes.map((scene) => ({ ...scene, scene_code: scene.scene_code ?? had.get(scene.id) })) })) } };
	}
	return next;
}

// --- Words for the screens ------------------------------------------------------------------------------------

const plural = (n: number, things: string) => `${n} ${n === 1 ? things.replace(/s$/, '') : things}`;

/** What a level's row says beside its name: "5 proposed", "3 approved", "1 new", or nothing while it is empty. */
export function levelSummary(level: StoryLevel, state: LevelState, count: number, open = 0, approvedBefore = false): string {
	if (state === 'empty') return '';
	if (state === 'approved') return level === 'brief' ? 'Approved' : `${count} approved`;
	if (approvedBefore && open > 0) return `${open} new`;
	return level === 'brief' ? 'Proposed' : `${count} proposed`;
}

/** The approve button of a level: "Approve 5 scenes", or "Approve 1 new scene" for what was added since. */
export function approveLabel(level: StoryLevel, count: number, open = 0, approvedBefore = false): string {
	if (level === 'brief') return 'Approve brief';
	if (count === 0) return `Approve ${WORDS[level].things}`;
	return approvedBefore && open > 0 ? `Approve ${plural(open, `new ${WORDS[level].things}`)}` : `Approve ${plural(count, WORDS[level].things)}`;
}

/** The "Next" line while the story plan is being approved; null once every level is. */
export function levelNextLine(states: LevelStates): string | null {
	const next = nextLevel(states);
	if (!next) return null;
	if (states[next] === 'empty') return next === 'brief' ? 'Say the idea, and the Agent drafts the brief' : `Propose ${WORDS[next].the}`;
	const following = STORY_LEVELS[STORY_LEVELS.indexOf(next) + 1];
	return `Approve ${WORDS[next].the}${following ? `, then ${WORDS[following].label.toLowerCase()}` : ''}`;
}

/**
 * A project's "Next" line from its story plan: used until all five levels are approved, on a project that is
 * being planned here (it has no shots yet, or a level has been approved). A project whose shots came some other
 * way keeps the line about its shots.
 */
export function storyNextLine(project: Project): string | null {
	if (!project.production.story_plan) return null;
	const planning = project.production.cards.length === 0 || Object.keys(approvalsOf(project)).length > 0;
	return planning ? levelNextLine(levelsOf(project)) : null;
}

/**
 * Board groups as the outline lists them (decision 15): scenes first, each with its scene code, in story order;
 * then the groups that are not scenes, whose shots are unplaced.
 */
export function placedGroups<G extends { group_id: string }>(project: Project, groups: G[]): { scenes: Array<G & { code: string; title?: string }>; unplaced: G[] } {
	const coded = codedGroups(project);
	const order = [...coded.keys()];
	// A group made for a story plan scene reads by the scene's own title, which can change; a group that was there before keeps its name.
	const titles = new Map(planScenes(project.production).flatMap((scene) => (scene.group_id ? [] : [[sceneGroupId(scene), scene.title] as const])));
	const scenes = groups.flatMap((group) => { const code = coded.get(group.group_id); return code ? [{ ...group, code, title: titles.get(group.group_id) }] : []; }).toSorted((a, b) => order.indexOf(a.group_id) - order.indexOf(b.group_id));
	return { scenes, unplaced: groups.filter((group) => !coded.has(group.group_id)) };
}
