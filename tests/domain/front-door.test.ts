import { expect, test } from 'bun:test';
import { DOOR_EXAMPLES, doorHeld, doorStart, sortDrop, workingTitle } from '../../src/lib/domain/front-door';

test('a drop is sorted into what each file is', () => {
	const sorted = sortDrop(['01_wide.png', 'take 3.mp4', 'theme.mp3', 'bible.md', 'notes.txt', 'manifest.json', 'budget.xlsx', 'score.wav']);
	expect(sorted).toEqual({ media: ['01_wide.png', 'take 3.mp4'], songs: ['theme.mp3', 'score.wav'], texts: ['bible.md', 'notes.txt', 'manifest.json'], other: ['budget.xlsx'] });
});

test('the working title is the first sentence, cut at a word, without its full stop', () => {
	expect(workingTitle("It's a vampire thing, but it all happens in a video store at night.")).toBe("It's a vampire thing, but it all happens in a…");
	expect(workingTitle('Late Fees.')).toBe('Late Fees');
	expect(workingTitle('  A heist.\nBut quiet. ')).toBe('A heist');
	expect(workingTitle('')).toBe('Untitled project');
	expect(workingTitle('Pitch me three loglines.')).toBe('Pitch me three loglines');
});

test('one sentence and nothing else starts from the idea: the Agent drafts the brief', () => {
	expect(doorStart({ text: "It's a vampire thing in a video store at night." })).toEqual({
		ok: true, way: 'idea', path: 'have_idea', title: "It's a vampire thing in a video store at night", text: "It's a vampire thing in a video store at night.", then: 'draft_brief'
	});
});

test('asking for a pitch, or saying nothing at all, starts with three loglines', () => {
	expect(doorStart({ text: 'Pitch me three loglines.' })).toEqual({ ok: true, way: 'pitch', path: 'need_idea', title: 'Untitled project', text: '', then: 'pitch' });
	expect(doorStart({ text: 'Surprise me.' })).toMatchObject({ way: 'pitch', text: '' });
	expect(doorStart({ text: '' })).toMatchObject({ way: 'pitch', path: 'need_idea', title: 'Untitled project' });
	// A direction given with the ask is what the pitches grow from.
	expect(doorStart({ text: 'Something like a heist, but quiet.', pitch: true })).toEqual({ ok: true, way: 'pitch', path: 'need_idea', title: 'Something like a heist, but quiet', text: 'Something like a heist, but quiet.', then: 'pitch' });
	expect(doorStart({ text: 'pitch me three: a lighthouse keeper who never sleeps' })).toMatchObject({ way: 'pitch', text: 'a lighthouse keeper who never sleeps' });
	// The word alone does not make it an ask.
	expect(doorStart({ text: 'Pitch black night in a lighthouse.' })).toMatchObject({ way: 'idea', text: 'Pitch black night in a lighthouse.' });
});

test('a Notion series or a pasted story starts from the story', () => {
	expect(doorStart({ text: "Here's my Notion series. Make the trailer.", notion: 'https://www.notion.so/Blood-Rush-0123456789abcdef0123456789abcdef' })).toEqual({
		ok: true, way: 'story', path: 'have_story', title: 'Blood Rush', text: '', notion_root: 'https://www.notion.so/Blood-Rush-0123456789abcdef0123456789abcdef', then: 'draft_brief'
	});
	expect(doorStart({ text: '', seriesId: 'series-1', seriesTitle: 'Blood Rush' })).toMatchObject({ way: 'story', path: 'have_story', title: 'Blood Rush', series_id: 'series-1' });
	// A link pasted into the sentence is found.
	expect(doorStart({ text: 'Make the trailer from https://www.notion.so/Blood-Rush-0123456789abcdef0123456789abcdef please' })).toMatchObject({ way: 'story', notion_root: 'https://www.notion.so/Blood-Rush-0123456789abcdef0123456789abcdef' });
	// Text files from a show folder are the story.
	expect(doorStart({ text: 'This folder is the whole show.', story: 'ACT ONE\nKai walks.' })).toEqual({ ok: true, way: 'story', path: 'have_story', title: 'This folder is the whole show', text: 'ACT ONE\nKai walks.', then: 'draft_brief' });
});

test('media with no words still starts a project; the sentence can come later', () => {
	expect(doorStart({ text: '', media: 8 })).toEqual({ ok: true, way: 'idea', path: 'have_idea', title: 'Untitled project', text: 'Made from 8 dropped files.', then: 'draft_brief' });
	expect(doorStart({ text: 'Cut it to this song.', song: 'theme.mp3' })).toMatchObject({ way: 'idea', path: 'have_idea', title: 'Cut it to this song' });
});

test('what is held reads as one short line per kind', () => {
	expect(doorHeld({ media: 8, song: 'theme.mp3', texts: 2, notion: true })).toEqual({ notion: 'Linked', folder: '2 text files', media: '8 files', song: 'theme.mp3' });
	expect(doorHeld({ media: 1, song: null, texts: 0, notion: false })).toEqual({ notion: '', folder: '', media: '1 file', song: '' });
});

test('the examples come in two groups, and the second group asks for a pitch', () => {
	expect(DOOR_EXAMPLES.map((group) => group.title)).toEqual(['You have something', 'You have nothing yet']);
	expect(DOOR_EXAMPLES[1].phrases.every((phrase) => doorStart({ text: phrase, pitch: true }).ok)).toBe(true);
	expect(DOOR_EXAMPLES[0].pitch).toBe(false);
	expect(DOOR_EXAMPLES[1].pitch).toBe(true);
});
