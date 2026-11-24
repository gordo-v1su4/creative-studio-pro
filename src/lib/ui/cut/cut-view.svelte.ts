/**
 * What the Cut stage has open, shared by its outline (in the shell's outline panel), its work area and the dock:
 * the cut, the version chosen in the outline (null: the step's own choice, domain/cut-stage shownVersion), the
 * entry at the playhead, and the QC check whose items show in Details.
 */
class CutView {
	cutId = $state<string | null>(null);
	version = $state<number | null>(null);
	entry = $state(0);
	qcCheck = $state<string | null>(null);

	open(cutId: string, version: number | null = null) {
		if (cutId !== this.cutId || version !== this.version) this.entry = 0;
		this.cutId = cutId;
		this.version = version;
		this.qcCheck = null;
	}
}

export const cutView = new CutView();
