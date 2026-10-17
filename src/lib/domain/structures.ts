/**
 * Structures (CONTEXT.md): a storytelling template made of named, empty sections. A story beat sits in one
 * section and plays out over scenes. A season follows Save the Cat; each episode follows the TV episode.
 * More (Storyception's list) can be added later.
 */

export interface Structure { id: StructureId; name: string; sections: readonly string[] }
export type StructureId = 'save-the-cat' | 'tv-episode';

export const SAVE_THE_CAT: Structure = {
	id: 'save-the-cat',
	name: 'Save the Cat',
	sections: ['Opening Image', 'Theme Stated', 'Set-Up', 'Catalyst', 'Debate', 'Break into Two', 'B Story', 'Fun and Games', 'Midpoint', 'Bad Guys Close In', 'All Is Lost', 'Dark Night of the Soul', 'Break into Three', 'Finale', 'Final Image']
};

export const TV_EPISODE: Structure = {
	id: 'tv-episode',
	name: 'TV episode',
	sections: ['Teaser', 'Act 1', 'Act 2', 'Act 3', 'Tag']
};

export const STRUCTURES: Record<StructureId, Structure> = { 'save-the-cat': SAVE_THE_CAT, 'tv-episode': TV_EPISODE };

/** The section's place in its structure (unknown sections sort last). */
export function sectionRank(structure: Structure, section: string): number {
	const at = structure.sections.findIndex((name) => name.toLowerCase() === section.trim().toLowerCase());
	return at < 0 ? structure.sections.length : at;
}

/** A story beat's colour: its place in the season spread over teal → blue → violet (the app's accent ramp, never a rainbow). */
export function storyBeatColor(index: number, total: number): string {
	const t = total <= 1 ? 0 : index / (total - 1);
	return `hsl(${Math.round(172 + t * 98)} 70% 62%)`;
}

/** Sections of a structure that no story beat fills yet, in order. */
export function emptySections(structure: Structure, filled: Iterable<string>): string[] {
	const have = new Set([...filled].map((name) => name.trim().toLowerCase()));
	return structure.sections.filter((name) => !have.has(name.toLowerCase()));
}
