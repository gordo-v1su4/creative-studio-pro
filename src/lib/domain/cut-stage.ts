import type { Cut, CutVersion } from './schemas';
import type { WorkspaceTab } from './stages';
import { cutLength } from './cuts';

/**
 * The Cut stage (slice 7): one stage with three steps, Picture, Sound and Export. Picture edits the version being
 * worked on; Sound and Export work on a locked version, because sound belongs to an exact locked picture. These
 * rules say which cut and version a step shows, what stops a step, and the one line of facts in its header. How
 * cuts, mixing, export and QC work is unchanged (SPEC: Cut only moves into the shell).
 */

export type CutStep = 'picture' | 'sound' | 'export';

export function stepOfTab(tab: WorkspaceTab): CutStep {
	return tab === 'sound' ? 'sound' : tab === 'export' ? 'export' : 'picture';
}

export type VersionRow = {
	version: number;
	/** The version being worked on and not locked. */
	editing: boolean;
	locked: boolean;
	mixed: boolean;
	exported: boolean;
	entries: number;
	/** Seconds, as the ramps play it. */
	length: number;
	lockedAt: string | null;
	/** The recorded locked version, for its sound; null while editing. */
	record: CutVersion | null;
};

/** The cut's versions, newest first: the one being edited (when it is not locked), then every locked one. */
export function versionRows(cut: Cut): VersionRow[] {
	const locked = [...(cut.versions ?? [])].sort((a, b) => b.version - a.version).map((v): VersionRow => ({
		version: v.version, editing: false, locked: true, mixed: !!v.sound?.mix, exported: !!v.sound?.export,
		entries: v.entries.length, length: cutLength(v), lockedAt: v.locked_at, record: v
	}));
	if (cut.locked && locked.some((row) => row.version === cut.version)) return locked;
	const editing: VersionRow = { version: cut.version, editing: true, locked: false, mixed: false, exported: false, entries: cut.entries.length, length: cutLength(cut), lockedAt: null, record: null };
	return [editing, ...locked.filter((row) => row.version !== cut.version)];
}

export function versionLabel(row: Pick<VersionRow, 'editing' | 'mixed' | 'exported'>): string {
	if (row.editing) return 'Editing';
	return ['Locked', row.mixed && 'mixed', row.exported && 'exported'].filter(Boolean).join(' · ');
}

/** The cut the stage opens: the chosen one while it exists, else the one changed last. */
export function openCutOf(cuts: readonly Cut[], chosen: string | null): Cut | null {
	return cuts.find((cut) => cut.cut_id === chosen) ?? [...cuts].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

/** The version a step shows. Picture: the chosen one, else the current. Sound and Export: a locked one, or none. */
export function shownVersion(cut: Cut, chosen: number | null, step: CutStep): number | null {
	const rows = versionRows(cut);
	if (step === 'picture') return rows.some((row) => row.version === chosen) ? chosen : cut.version;
	const locked = rows.filter((row) => row.locked);
	return locked.find((row) => row.version === chosen)?.version ?? locked[0]?.version ?? null;
}

/** Why a step cannot work on what it shows, or null. */
export function stepBlocked(cut: Cut, version: number | null, step: CutStep): string | null {
	if (step === 'picture') return null;
	const row = versionRows(cut).find((entry) => entry.version === version && entry.locked);
	if (!row) return `Nothing of ${cut.name} is locked yet. Lock v${cut.version} in Picture to lay sound against it.`;
	if (step === 'export' && !row.mixed) return `v${row.version} has no mix yet. Build it in Sound first.`;
	return null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The header's line of facts for the version a step shows. */
export function cutBar(cut: Cut, version: number, step: CutStep): string {
	const row = versionRows(cut).find((entry) => entry.version === version);
	if (!row) return '';
	const length = `${row.length.toFixed(1)}s`;
	if (step === 'picture') return `${row.entries} ${row.entries === 1 ? 'entry' : 'entries'} · ${length} · ${row.editing ? 'edits save to this cut' : 'picture locked · read-only'}`;
	const locked = row.lockedAt ? `Picture locked ${day(row.lockedAt)}` : 'Not locked';
	if (step === 'sound') return `${locked} · ${length}`;
	const mix = row.record?.sound?.mix ? `mix built ${day(row.record.sound.mix.built_at)}` : 'no mix';
	return `${locked} · ${mix} · ${length}`;
}

/** The Next line while the Cut stage shows: what the version on screen waits on. */
export function cutNext(cut: Cut | null, version: number | null, step: CutStep): string {
	if (!cut) return 'No cuts yet · push a selection from Shots';
	const row = versionRows(cut).find((entry) => entry.version === version);
	if (!row || row.editing) return `Lock v${cut.version} to lay sound against it`;
	if (!row.mixed) return step === 'sound' ? `Build the mix of v${row.version}` : `Build the mix of v${row.version} in Sound`;
	if (!row.exported) return `Export v${row.version}`;
	return `v${row.version} is exported`;
}
