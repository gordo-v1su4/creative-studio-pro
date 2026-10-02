import type { Cut, CutEntry, CutMusic, ProductionState, SoundPlan } from './schemas';
import type { TakeResult } from './takes';
import { programElapsed } from '../media/speed-curve';

/**
 * Cuts (CONTEXT.md: Cut, Push, Trim, Speed ramp). A push snapshots a selection
 * into a new named cut: each entry names its beat and take and carries its own
 * copy of the trim and ramp. From then on the cut and the board are apart:
 * board edits (trims on takes, picks, benching, rewiring) never reach a cut,
 * and editing a cut never touches takes or beats.
 */

export type CutEntryInput = Omit<CutEntry, 'entry_id'>;

export function cutsOf(production: ProductionState): Cut[] {
	return production.cuts ?? [];
}

/** "Cut N" for the first N not already taken. */
export function nextCutName(production: ProductionState): string {
	const names = new Set(cutsOf(production).map((cut) => cut.name));
	let n = cutsOf(production).length + 1;
	while (names.has(`Cut ${n}`)) n += 1;
	return `Cut ${n}`;
}

/** Running length in seconds: each entry's kept span as its ramp plays it. */
export function cutLength(cut: Pick<Cut, 'entries'>): number {
	return cut.entries.reduce((sum, entry) => sum + programElapsed(entry.speed, entry.out_s - entry.in_s), 0);
}

/** A deep copy so the cut never shares a ramp array with a take or a caller. */
function copyEntry(entry: CutEntry): CutEntry {
	const { speed, ...rest } = entry;
	return speed?.length ? { ...rest, speed: speed.map((point) => ({ ...point })) } : rest;
}

function checkTrim(entry: CutEntryInput): string | null {
	return entry.out_s > entry.in_s ? null : `Trim out (${entry.out_s}s) must be after in (${entry.in_s}s)`;
}

function checkTake(production: ProductionState, entry: CutEntryInput): string | null {
	if (!production.cards.some((card) => card.card_id === entry.card_id)) return `Beat ${entry.card_id} not on this project`;
	const take = production.assets.find((asset) => asset.asset_id === entry.asset_id);
	if (!take || take.kind === 'audio' || take.card_id !== entry.card_id) return `Take ${entry.asset_id} is not a take of beat ${entry.card_id}`;
	if (take.rejected) return `${take.name} is rejected; restore it on the board to use it`;
	return null;
}

function withCuts(production: ProductionState, cuts: Cut[]): ProductionState {
	return { ...production, cuts };
}

/** A whole-production save (board, beats, takes) keeps the stored cuts, whatever the saved copy holds. */
export function keepStoredCuts(saved: ProductionState, stored: ProductionState): ProductionState {
	const { cuts: _ignored, ...rest } = saved;
	return stored.cuts ? { ...rest, cuts: stored.cuts } : rest;
}

export function applyPushCut(
	production: ProductionState,
	cut: { cut_id: string; name: string; entries: CutEntryInput[] },
	newId: () => string,
	now: string
): TakeResult {
	if (cut.entries.length === 0) return { ok: false, message: 'A cut needs at least one take' };
	if (cutsOf(production).some((existing) => existing.cut_id === cut.cut_id)) return { ok: false, message: `Cut ${cut.cut_id} already exists` };
	for (const entry of cut.entries) {
		const problem = checkTrim(entry) ?? checkTake(production, entry);
		if (problem) return { ok: false, message: problem };
	}
	const pushed: Cut = {
		cut_id: cut.cut_id,
		name: cut.name.trim(),
		version: 1,
		locked: false,
		entries: cut.entries.map((entry) => copyEntry({ ...entry, entry_id: newId() })),
		created_at: now,
		updated_at: now
	};
	return { ok: true, production: withCuts(production, [...cutsOf(production), pushed]) };
}

/**
 * Replace a cut's entries (order, trims, ramps, dropped entries). Each entry
 * must already be in the cut or name a live take of its beat; an entry kept
 * unchanged from the cut stays valid even if its take has since gone.
 */
export function applyEditCut(production: ProductionState, cutId: string, entries: CutEntry[], now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	if (cut.locked) return { ok: false, message: `${cut.name} is locked; unlock it to edit` };
	if (entries.length === 0) return { ok: false, message: 'A cut needs at least one take' };
	if (new Set(entries.map((entry) => entry.entry_id)).size !== entries.length) return { ok: false, message: 'Cut entries must be unique' };
	const before = new Map(cut.entries.map((entry) => [entry.entry_id, entry]));
	for (const entry of entries) {
		const known = before.get(entry.entry_id);
		const sameTake = known && known.card_id === entry.card_id && known.asset_id === entry.asset_id;
		const problem = checkTrim(entry) ?? (sameTake ? null : checkTake(production, entry));
		if (problem) return { ok: false, message: problem };
	}
	const edited: Cut = { ...cut, entries: entries.map(copyEntry), updated_at: now };
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? edited : entry))) };
}

/** Lock: the picture of the current version is frozen and recorded, readable from then on. */
export function applyLockCut(production: ProductionState, cutId: string, now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	if (cut.locked) return { ok: false, message: `${cut.name} v${cut.version} is already locked` };
	const versions = [...(cut.versions ?? []).filter((v) => v.version !== cut.version), { version: cut.version, entries: cut.entries.map(copyEntry), locked_at: now }];
	const locked: Cut = { ...cut, locked: true, locked_at: now, versions, updated_at: now };
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? locked : entry))) };
}

/** Unlock: the next version starts as a copy of the locked one; the locked version stays as it was. */
export function applyUnlockCut(production: ProductionState, cutId: string, now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	if (!cut.locked) return { ok: false, message: `${cut.name} is not locked` };
	const { locked_at: _was, ...rest } = cut;
	const next: Cut = { ...rest, locked: false, version: cut.version + 1, entries: cut.entries.map(copyEntry), updated_at: now };
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? next : entry))) };
}

/** A version's entries: a recorded locked version, or the cut's current picture. */
export function cutVersionEntries(cut: Cut, version: number): CutEntry[] | null {
	if (version === cut.version) return cut.entries;
	return cut.versions?.find((v) => v.version === version)?.entries ?? null;
}

/** Attach or remove a cut's song. Music isn't picture, so a locked cut can take one. */
export function applySetCutMusic(production: ProductionState, cutId: string, music: CutMusic | null, now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	const { music: _old, ...rest } = cut;
	const next: Cut = music ? { ...rest, music, updated_at: now } : { ...rest, updated_at: now };
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? next : entry))) };
}

/** Save the sound plan of a locked version (sound always belongs to an exact locked picture). */
export function applySetSoundPlan(production: ProductionState, cutId: string, version: number, plan: SoundPlan, now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	const locked = cut.versions?.find((v) => v.version === version);
	if (!locked) return { ok: false, message: `${cut.name} v${version} is not a locked version; lock the cut to lay sound against it` };
	const versions = cut.versions!.map((v) => (v.version === version ? { ...v, sound: plan } : v));
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? { ...cut, versions, updated_at: now } : entry))) };
}

export function applyRenameCut(production: ProductionState, cutId: string, name: string, now: string): TakeResult {
	const cut = cutsOf(production).find((entry) => entry.cut_id === cutId);
	if (!cut) return { ok: false, message: `Cut ${cutId} not found` };
	const renamed: Cut = { ...cut, name: name.trim(), updated_at: now };
	return { ok: true, production: withCuts(production, cutsOf(production).map((entry) => (entry.cut_id === cutId ? renamed : entry))) };
}
