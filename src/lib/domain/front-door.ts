import { mediaKind } from './media';

/**
 * The front door (decision 3): one screen that asks what is being made and takes whatever the operator has.
 * These are its rules: what each dropped file is, which way a start goes, and what the project is called until
 * the brief names it.
 */

/** The example phrases, in the two groups the screen shows (story 3). The second group asks the Agent for a pitch. */
export const DOOR_EXAMPLES = [
	{ title: 'You have something', pitch: false, phrases: ["Here's my Notion series. Make the trailer.", 'This folder is the whole show.', 'Turn these eight stills into a teaser.', 'Cut it to this song.'] },
	{ title: 'You have nothing yet', pitch: true, phrases: ['Pitch me three loglines.', 'Something like a heist, but quiet.', 'Surprise me.'] }
] as const;

const SONG = /\.(mp3|wav|m4a|aac|flac|ogg|aiff?)$/i;
const TEXT = /\.(md|markdown|txt|json|fountain)$/i;

/** A drop, sorted by what each file is: pictures and clips, songs, text that tells the story, and the rest. */
export function sortDrop(names: string[]): { media: string[]; songs: string[]; texts: string[]; other: string[] } {
	const out = { media: [] as string[], songs: [] as string[], texts: [] as string[], other: [] as string[] };
	for (const name of names) (mediaKind(name) ? out.media : SONG.test(name) ? out.songs : TEXT.test(name) ? out.texts : out.other).push(name);
	return out;
}

const TITLE_MAX = 48;
export const UNTITLED = 'Untitled project';

/**
 * What a project is called until its brief gives it a title: its first sentence, cut at a word.
 * A project still carrying this name takes the brief's title when the brief is approved.
 */
export function workingTitle(text: string): string {
	const sentence = (text.trim().split(/\n|(?<=[.!?])\s/)[0] ?? '').trim().replace(/[.!?\s]+$/, '');
	if (!sentence) return UNTITLED;
	if (sentence.length <= TITLE_MAX) return sentence;
	const cut = sentence.slice(0, TITLE_MAX + 1);
	return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : TITLE_MAX).replace(/[,;:\s]+$/, '')}…`;
}

const NOTION_LINK = /https:\/\/(?:www\.)?notion\.(?:so|site)\/\S+/i;
/** "…/Blood-Rush-0123456789abcdef0123456789abcdef" → "Blood Rush": a title from a Notion link, until the series itself is read. */
function notionTitle(link: string): string {
	const slug = decodeURIComponent(link.split(/[?#]/)[0].split('/').filter(Boolean).at(-1) ?? '').replace(/-?[0-9a-f]{32}$/i, '');
	return slug.replace(/-/g, ' ').trim() || 'Notion series';
}

/** Words that only ask for a pitch; what follows them, if anything, is the direction to pitch in. */
const KIND = '(?:\\s+(?:loglines?|ideas?))?';
const PITCH_ASK = new RegExp(`^\\s*(?:pitch\\s+me(?:\\s+(?:three|3))?${KIND}|pitch\\s+(?:three|3)${KIND}|pitch\\s+(?:loglines?|ideas?)|pitch(?=\\s*[.!]*\\s*$)|surprise\\s+me|give\\s+me\\s+(?:three\\s+|3\\s+)?(?:loglines?|ideas?))\\s*[.!:,–—-]*\\s*`, 'i');

export interface DoorInput {
	text: string;
	/** A "nothing yet" example was chosen: the text is a direction to pitch in, not the idea itself. */
	pitch?: boolean;
	/** A Notion series link, or a series already connected. */
	notion?: string; seriesId?: string; seriesTitle?: string;
	/** Story text read from dropped text files. */
	story?: string;
	/** How many pictures and clips are held, and the song's name. */
	media?: number; song?: string | null;
}

export type DoorStart = {
	ok: true;
	/** From an idea, from a story that already exists, or from nothing (the Agent pitches). */
	way: 'idea' | 'story' | 'pitch';
	path: 'have_idea' | 'have_story' | 'need_idea';
	title: string; text: string;
	notion_root?: string; series_id?: string;
	/** What the Agent does first, unasked (story 6). */
	then: 'draft_brief' | 'pitch';
};

/** Which way a start goes, from what was typed and what is held. Everything it returns goes to the start endpoint. */
export function doorStart(input: DoorInput): DoorStart {
	const text = input.text.trim();
	const link = input.notion?.trim() || NOTION_LINK.exec(text)?.[0];
	if (input.seriesId) return { ok: true, way: 'story', path: 'have_story', title: input.seriesTitle?.trim() || workingTitle(text), text: '', series_id: input.seriesId, then: 'draft_brief' };
	if (link) return { ok: true, way: 'story', path: 'have_story', title: notionTitle(link), text: '', notion_root: link, then: 'draft_brief' };
	if (input.story?.trim()) return { ok: true, way: 'story', path: 'have_story', title: workingTitle(text || input.story), text: input.story.trim(), then: 'draft_brief' };
	const held = (input.media ?? 0) > 0 || !!input.song;
	const asks = PITCH_ASK.test(text);
	if (input.pitch || asks || (!text && !held)) {
		const direction = asks ? text.replace(PITCH_ASK, '').trim() : text;
		return { ok: true, way: 'pitch', path: 'need_idea', title: workingTitle(direction), text: direction, then: 'pitch' };
	}
	const files = input.media ?? 0;
	return { ok: true, way: 'idea', path: 'have_idea', title: workingTitle(text), text: text || `Made from ${files} dropped file${files === 1 ? '' : 's'}.`, then: 'draft_brief' };
}

/** What each drop target holds, as the few words shown on it. */
export function doorHeld(held: { media: number; song: string | null; texts: number; notion: boolean }): { notion: string; folder: string; media: string; song: string } {
	const count = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
	return { notion: held.notion ? 'Linked' : '', folder: count(held.texts, 'text file'), media: count(held.media, 'file'), song: held.song ?? '' };
}
