/**
 * A prompt shown and edited in the sections of the skill that wrote it (DESIGN.md: Prompt view). Ghost writes a
 * video prompt as a header and eleven named sections; ONE SHOT writes an image prompt as shot, action, place and
 * light. Splitting never changes the text: putting the sections back gives the prompt that will be sent.
 */
import { GHOST_SECTIONS } from './ghost-qc';

export interface PromptSection {
	/** Stable id of the section within its prompt. */
	key: string;
	/** What the row is called. */
	label: string;
	text: string;
	/** A section the skill defines that this prompt does not have. */
	missing?: boolean;
}

const GHOST_LABELS: Record<(typeof GHOST_SECTIONS)[number], string> = {
	'SCENE + REALISM LOCK': 'Scene', REFERENCES: 'References', CHARACTERS: 'Characters', SPACE: 'Space', 'FIRST FRAME': 'First frame',
	TIMELINE: 'Timeline', PHYSICS: 'Physics', CAMERA: 'Camera', 'LIGHT / COLOUR': 'Light', SOUND: 'Sound', LOCKS: 'Locks'
};

/** A section heading at the start of a line (numbering and Markdown bold allowed), up to where its text begins. */
const heading = (name: string) => {
	const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s*');
	return new RegExp(`^[ \\t>*#\\d.)-]*\\**${escaped}\\**[ \\t]*[:—–-][ \\t]*`, 'mi');
};

interface Found { name: (typeof GHOST_SECTIONS)[number]; at: number; body: number }

function ghostHeadings(prompt: string): Found[] {
	return GHOST_SECTIONS.flatMap((name) => {
		const match = heading(name).exec(prompt);
		return match ? [{ name, at: match.index, body: match.index + match[0].length }] : [];
	}).sort((a, b) => a.at - b.at);
}

/**
 * A video prompt as Ghost's header and eleven sections, in Ghost's order, or null when it is not written that way
 * (fewer than three of the sections are there). A section the prompt lacks is listed as missing, with no text.
 */
export function ghostSections(prompt: string): PromptSection[] | null {
	const found = ghostHeadings(prompt);
	if (found.length < 3) return null;
	const text = (name: string) => {
		const i = found.findIndex((entry) => entry.name === name);
		return i < 0 ? null : prompt.slice(found[i].body, found[i + 1]?.at ?? prompt.length).trim();
	};
	return [
		{ key: 'header', label: 'Header', text: prompt.slice(0, found[0].at).trim() },
		...GHOST_SECTIONS.map((name) => {
			const body = text(name);
			return { key: name, label: GHOST_LABELS[name], text: body ?? '', ...(body === null ? { missing: true } : {}) };
		})
	];
}

/** The video prompt with one section's text replaced; everything else, headings included, stays as written. */
export function withGhostSection(prompt: string, key: string, text: string): string {
	const found = ghostHeadings(prompt);
	const body = text.trim();
	if (key === 'header') {
		const rest = found.length ? prompt.slice(found[0].at) : '';
		return found.length ? `${body}${body ? '\n\n' : ''}${rest}` : body;
	}
	const i = found.findIndex((entry) => entry.name === key);
	if (i >= 0) {
		const next = found[i + 1]?.at ?? prompt.length;
		return `${prompt.slice(0, found[i].body)}${body}${next < prompt.length ? '\n\n' : ''}${prompt.slice(next)}`;
	}
	// A missing section is written in before the next one Ghost's order has, or at the end.
	const order = GHOST_SECTIONS.indexOf(key as (typeof GHOST_SECTIONS)[number]);
	if (order < 0) return prompt;
	const after = found.find((entry) => GHOST_SECTIONS.indexOf(entry.name) > order);
	const block = `${key}: ${body}`;
	return after ? `${prompt.slice(0, after.at)}${block}\n\n${prompt.slice(after.at)}` : `${prompt.trimEnd()}\n\n${block}`;
}

/**
 * An image prompt as ONE SHOT writes it from a shot spec: "Wide shot, eye level — what happens. In the place. The
 * light." Null when it is not written that way.
 */
export function imageSections(prompt: string): PromptSection[] | null {
	const dash = prompt.indexOf(' — ');
	if (dash < 1 || dash > 80 || /[.\n]/.test(prompt.slice(0, dash))) return null;
	const rest = prompt.slice(dash + 3).trim();
	const place = /(^|[.!?"”]\s+)In ([^.\n]+)\.\s*/.exec(rest);
	if (!place) return [{ key: 'shot', label: 'Shot', text: prompt.slice(0, dash).trim() }, { key: 'action', label: 'Action', text: rest }];
	const actionEnd = place.index + place[1].trimEnd().length;
	return [
		{ key: 'shot', label: 'Shot', text: prompt.slice(0, dash).trim() },
		{ key: 'action', label: 'Action', text: rest.slice(0, actionEnd).trim() },
		{ key: 'place', label: 'Place', text: place[2].trim() },
		{ key: 'light', label: 'Light', text: rest.slice(place.index + place[0].length).trim() }
	];
}

/** The image prompt with one section's text replaced, put back together the way ONE SHOT writes it. */
export function withImageSection(prompt: string, key: string, text: string): string {
	const sections = imageSections(prompt);
	if (!sections) return prompt;
	const value = (name: string) => (name === key ? text.trim() : sections.find((section) => section.key === name)?.text ?? '');
	const place = value('place').replace(/\.$/, '');
	return [`${value('shot')} — ${value('action')}`, place ? `In ${place}.` : '', value('light')].filter(Boolean).join(' ');
}
