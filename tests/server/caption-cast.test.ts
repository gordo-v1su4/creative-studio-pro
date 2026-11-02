import { describe, expect, it } from 'bun:test';
import { castFor, castLabel, castSeries, namedSubjects } from '../../src/lib/server/caption-cast';
import type { SeriesReferenceItem } from '../../src/lib/server/references';

const ref = (name: string, handles: string[], kind = 'Character'): SeriesReferenceItem => ({ page_id: name.replace(/\W/g, '').toLowerCase(), name, kind, role: '', handles, file_name: `${name}.png`, name_on_sheet: true, scene_ids: [] }) as unknown as SeriesReferenceItem;
const kai = ref('Kai "Hoodie" Santana', ['@Kai']);
const mara = ref('Mara Voss', ['@Mara']);
const elias = ref('Elias Mercer', ['@Elias']);
const rowan = ref('Rowan Mercer', ['@Rowan']);
const quad = ref('College Quad', ['@Quad'], 'Location');
const all = [elias, kai, mara, rowan, quad];

describe('castFor', () => {
	it('picks the characters the shot names, in the order it names them, two at most', () => {
		expect(castFor({ title: 'Mara watches as @Kai lands; Elias looks away' }, all).map((m) => m.label)).toEqual(['Mara', 'Kai']);
	});

	it('knows a nickname and a surname-only mention is not enough', () => {
		expect(castFor({ title: 'Hoodie sprints across the roof past the Mercer house' }, all).map((m) => m.label)).toEqual(['Kai']);
	});

	it('does not match a name inside another word, or a location', () => {
		expect(castFor({ title: 'Kaiser roll on the College Quad' }, all)).toEqual([]);
	});

	it('falls back to the project regulars when the shot names nobody', () => {
		expect(castFor({ title: 'Title / black' }, all, [kai, mara]).map((m) => m.label)).toEqual(['Kai', 'Mara']);
	});

	it('puts title names first, then the characters the prompt names most', () => {
		expect(castFor({ title: '25-lucian-cigarette.mp4', body: '@Elias @Kai @Mara refs. Kai turns. Kai runs. Mara watches.' }, [...all, ref('Lucian Vale', ['@Lucian'])]).map((m) => m.label)).toEqual(['Lucian', 'Kai']);
	});

	it('labels a character by first name', () => {
		expect(castLabel(kai)).toBe('Kai');
	});
});

describe('namedSubjects', () => {
	const cast = castFor({ title: 'Kai and Mara' }, all);

	it('keeps cast names and turns anyone else into unknown', () => {
		expect(namedSubjects({ subjects: ['Kai', 'a young man with bleached hair'] }, cast)).toEqual(['Kai', 'unknown']);
	});

	it('takes supported evidence, not uncertain evidence', () => {
		expect(namedSubjects({ subjects: [], evidence: { subjects: [{ name: 'Mara Voss', confidence: 'supported' }, { name: 'Kai', confidence: 'uncertain' }] } }, cast)).toEqual(['Mara']);
	});

	it('takes a name from the caption when the subjects list only describes them', () => {
		expect(namedSubjects({ caption: 'Kai \'Hoodie\' Santana leaps over the street', subjects: ['a person in a hoodie'] }, cast)).toEqual(['Kai']);
		expect(namedSubjects({ caption: 'Kai watches two strangers', subjects: ['Kai', 'a man', 'a woman'] }, cast)).toEqual(['Kai', 'unknown']);
	});

	it('never names someone who was not in the headshots', () => {
		expect(namedSubjects({ subjects: ['Elias'] }, cast)).toEqual(['unknown']);
	});
});

describe('castSeries', () => {
	const store = (records: Array<{ series_id: string; title: string }>) => ({ list: async () => records, read: async (id: string) => records.find((r) => r.series_id === id) ?? null }) as never;
	const project = (title: string, series?: { series_id: string }) => ({ title, series }) as never;

	it('uses the series a trailer title starts with', async () => {
		expect((await castSeries(store([{ series_id: 'a', title: 'Blood' }, { series_id: 'b', title: 'Blood Rush' }]), project('Blood Rush — Teaser Trailer')))?.series_id).toBe('b');
	});

	it("prefers an episode's own series", async () => {
		expect((await castSeries(store([{ series_id: 'a', title: 'Other' }]), project('Blood Rush EP101', { series_id: 'a' })))?.series_id).toBe('a');
	});
});
