import { expect, test } from 'bun:test';
import { ghostSections, imageSections, withGhostSection, withImageSection } from '../../src/lib/domain/prompt-sections';
import { GHOST_SECTIONS } from '../../src/lib/domain/ghost-qc';

const ghost = [
	'4 s. Upload:',
	'SCENE + REALISM LOCK: A quad on an overcast morning; live-action film footage.',
	'REFERENCES: @Kai is the young man crossing the lawn.',
	'CHARACTERS: @Kai is the only named person in frame.',
	'SPACE: A wide lawn bordered by maples.',
	'FIRST FRAME: The near edge of a table fills the frame.',
	'TIMELINE: SHOT 1 | 0.0–4.0 s — the camera slides behind the table.',
	'PHYSICS: Wet grass, damp cloth.',
	'CAMERA: Slow lateral dolly.',
	'LIGHT / COLOUR: Soft grey sky as the only source.',
	'SOUND: Distant voices, paper.',
	'LOCKS: Faces and clothes stay exact.'
].join('\n\n');

test("a Ghost prompt splits into its header and eleven sections, in Ghost's order", () => {
	const sections = ghostSections(ghost)!;
	expect(sections.map((section) => section.label)).toEqual(['Header', 'Scene', 'References', 'Characters', 'Space', 'First frame', 'Timeline', 'Physics', 'Camera', 'Light', 'Sound', 'Locks']);
	expect(sections[0].text).toBe('4 s. Upload:');
	expect(sections[1].text).toBe('A quad on an overcast morning; live-action film footage.');
	expect(sections[9].text).toBe('Soft grey sky as the only source.');
	expect(sections.some((section) => section.missing)).toBe(false);
});

test('a section the prompt lacks is listed as missing, and plain prose is not split at all', () => {
	const short = ghost.replace('PHYSICS: Wet grass, damp cloth.\n\n', '');
	const physics = ghostSections(short)!.find((section) => section.key === 'PHYSICS')!;
	expect(physics).toEqual({ key: 'PHYSICS', label: 'Physics', text: '', missing: true });
	expect(ghostSections('A man walks across a lawn. The camera follows.')).toBeNull();
});

test('numbered and bold headings are still headings', () => {
	const marked = ghost.replace('SPACE:', '4. **SPACE**:').replace('CAMERA:', '**CAMERA** —');
	const sections = ghostSections(marked)!;
	expect(sections.find((section) => section.key === 'SPACE')!.text).toBe('A wide lawn bordered by maples.');
	expect(sections.find((section) => section.key === 'CAMERA')!.text).toBe('Slow lateral dolly.');
});

test('editing one section changes only that section', () => {
	const edited = withGhostSection(ghost, 'CAMERA', 'Locked off on sticks.');
	expect(edited).toBe(ghost.replace('Slow lateral dolly.', 'Locked off on sticks.'));
	expect(withGhostSection(ghost, 'LOCKS', 'No extra people.')).toBe(ghost.replace('Faces and clothes stay exact.', 'No extra people.'));
	expect(withGhostSection(ghost, 'header', '6 s. Upload: image 1 = Kai')).toBe(ghost.replace('4 s. Upload:', '6 s. Upload: image 1 = Kai'));
	// Putting the same text back changes nothing.
	for (const name of GHOST_SECTIONS) expect(withGhostSection(ghost, name, ghostSections(ghost)!.find((section) => section.key === name)!.text)).toBe(ghost);
});

test("a missing section is written in where Ghost's order puts it", () => {
	const short = ghost.replace('PHYSICS: Wet grass, damp cloth.\n\n', '');
	expect(withGhostSection(short, 'PHYSICS', 'Wet grass, damp cloth.')).toBe(ghost);
	const noLocks = ghost.replace('\n\nLOCKS: Faces and clothes stay exact.', '');
	expect(withGhostSection(noLocks, 'LOCKS', 'Faces and clothes stay exact.')).toBe(ghost);
});

const image = 'Wide shot, eye level — Overcast morning on @Quad: tables under the maples. @Kai crosses the far edge of the lawn. In @Quad. Overcast morning daylight, soft grey sky as the only source.';

test('an image prompt splits into shot, action, place and light', () => {
	expect(imageSections(image)!.map((section) => [section.label, section.text])).toEqual([
		['Shot', 'Wide shot, eye level'],
		['Action', 'Overcast morning on @Quad: tables under the maples. @Kai crosses the far edge of the lawn.'],
		['Place', '@Quad'],
		['Light', 'Overcast morning daylight, soft grey sky as the only source.']
	]);
	expect(imageSections('Close-up, low angle — A thumb rests on a red vial.')!.map((section) => section.label)).toEqual(['Shot', 'Action']);
	expect(imageSections('A thumb rests on a red vial in a dim room.')).toBeNull();
});

test('an edited image section goes back into the same sentence order', () => {
	expect(withImageSection(image, 'place', '@Quad')).toBe(image);
	expect(withImageSection(image, 'shot', 'Medium shot, low angle')).toBe(image.replace('Wide shot, eye level', 'Medium shot, low angle'));
	expect(withImageSection(image, 'light', 'Night, one sodium lamp.')).toBe(image.replace('Overcast morning daylight, soft grey sky as the only source.', 'Night, one sodium lamp.'));
});
