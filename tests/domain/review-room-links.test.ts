import { expect, test } from 'bun:test';
import { roomLink, sceneRoomLink, shotRoomLink } from '../../src/lib/domain/review-room-links';
import type { Project } from '../../src/lib/domain/schemas';

const base = 'https://review.example';
const project = {
	review_room: {
		project_id: 'proj1', folder_id: 'root',
		shots: { a: { code: 'BLR_TR100_SHT_0010', folder_id: 'folder-a' } },
		scenes: { g1: { code: 'DRP', folder_id: 'scene-1' } }
	},
	production: { cards: [{ card_id: 'a', group_id: 'g1' }, { card_id: 'b' }], assets: [] }
} as unknown as Project;
const take = { asset_id: 't1', card_id: 'a', review_room: { asset_id: 'asset-a', version_id: 'ver-3', version: 3, code: 'BLR_TR100_SHT_0010' } };

test('an address names the project, then as much as is known: folder, shot, version', () => {
	expect(roomLink(base, { project: 'p' })).toBe('https://review.example/?project=p');
	expect(roomLink(`${base}/`, { project: 'p', folder: 'f', asset: 'a', version: 'v' })).toBe('https://review.example/?project=p&folder=f&asset=a&version=v');
	expect(roomLink(base, { project: 'p', asset: 'BLR_TR100_SHT_0010' })).toBe('https://review.example/?project=p&asset=BLR_TR100_SHT_0010');
});

test('there is no link without an address for Review Room or a project there', () => {
	expect(roomLink(null, { project: 'p' })).toBeNull();
	expect(roomLink('', { project: 'p' })).toBeNull();
	expect(roomLink(base, { project: '' })).toBeNull();
	expect(shotRoomLink(base, { ...project, review_room: undefined } as unknown as Project, 'a', take)).toBeNull();
});

test('a stored take links to its exact version; a shot with nothing stored links to its folder', () => {
	expect(shotRoomLink(base, project, 'a', take)).toBe('https://review.example/?project=proj1&folder=folder-a&asset=asset-a&version=ver-3');
	expect(shotRoomLink(base, project, 'a', { asset_id: 't2', card_id: 'a' })).toBe('https://review.example/?project=proj1&folder=folder-a');
	expect(shotRoomLink(base, project, 'a', null)).toBe('https://review.example/?project=proj1&folder=folder-a');
	// A shot Review Room has no folder for yet opens the project's own folder.
	expect(shotRoomLink(base, project, 'b', null)).toBe('https://review.example/?project=proj1&folder=root');
});

test('a scene links to its folder, and a group that is not a scene there to the project folder', () => {
	expect(sceneRoomLink(base, project, 'g1')).toBe('https://review.example/?project=proj1&folder=scene-1');
	expect(sceneRoomLink(base, project, 'main')).toBe('https://review.example/?project=proj1&folder=root');
});
