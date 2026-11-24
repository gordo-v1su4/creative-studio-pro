import type { Cut, CutVersion, Project, SoundPlan } from '$lib/domain/schemas';
import { cutsOf } from '$lib/domain/cuts';
import { defaultSoundPlan, type Layer } from '$lib/domain/sound';
import { ui } from '$lib/ui/app-state.svelte';

/**
 * The sound of the locked version open in Cut → Sound (V1S-128, V1S-129), shared by the Sound step's lanes, the
 * dock's Details (placed effects) and the Agent tab (its effects proposal). The calls and what they save are
 * those of the old Sound tab; only where they are drawn changed (slice 7).
 */

export type EffectOffer = { moment_s: number; prompt: string; duration_s: number; at_s: number; reason: string; credits?: number; confirming?: boolean; busy?: boolean };
type Target = { projectId: string; cutId: string; version: number };
type Answer<T> = ({ ok: true; data: T } & Record<string, unknown>) | { ok: false; error: { message: string } };

class SoundDesk {
	/** The Sound step is on screen: the Agent tab offers its effects pass instead of the story actions. */
	open = $state(false);
	project = $state<Project | null>(null);
	cutId = $state<string | null>(null);
	version = $state<number | null>(null);
	plan = $state<SoundPlan>(defaultSoundPlan());
	saving = $state(false);
	building = $state(false);
	proposing = $state(false);
	error = $state<string | null>(null);
	offers = $state<EffectOffer[]>([]);
	/** What the last effects pass looked at and found. */
	proposeNote = $state<string | null>(null);
	private loadedFor = '';
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pending: (() => Promise<void>) | null = null;

	get cut(): Cut | null { return this.project && this.cutId ? cutsOf(this.project.production).find((cut) => cut.cut_id === this.cutId) ?? null : null; }
	get record(): CutVersion | null { return this.cut?.versions?.find((v) => v.version === this.version) ?? null; }
	get mix() { return this.record?.sound?.mix ?? null; }
	get suggested() { return this.plan.effects.filter((effect) => effect.suggested); }
	private get target(): Target | null { return this.project && this.cutId && this.version ? { projectId: this.project.project_id, cutId: this.cutId, version: this.version } : null; }
	private keyOf(target: Target | null) { return target ? `${target.projectId}:${target.cutId}:${target.version}` : ''; }

	/** Point the desk at a locked version; its plan is read again when the project changes and nothing waits to be saved. */
	sync(project: Project, cutId: string, version: number) {
		const before = this.keyOf(this.target);
		this.project = project;
		this.cutId = cutId;
		this.version = version;
		const now = this.keyOf(this.target);
		if (now !== before) {
			// A change waiting for the old version is saved there, never on the new one.
			if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; void this.pending?.(); }
			this.offers = []; this.proposeNote = null; this.error = null;
		}
		const stamp = `${now}@${project.version}`;
		if (stamp === this.loadedFor || this.saveTimer) return;
		this.loadedFor = stamp;
		this.plan = JSON.parse(JSON.stringify(this.record?.sound ?? defaultSoundPlan())) as SoundPlan;
	}

	private async send<T = Project>(body: Record<string, unknown>): Promise<Answer<T> & { ok: true }> {
		const project = this.project;
		if (!project) throw new Error('No project open');
		const response = await fetch(`/api/projects/${project.project_id}/sound`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const result = (await response.json()) as Answer<T>;
		if (!result.ok) throw new Error(result.error.message);
		return result;
	}

	private adopt(project: Project) {
		this.project = project;
		ui.adoptActiveProject(project);
	}

	private planToSave() {
		const { mix: _mix, ...rest } = $state.snapshot(this.plan) as SoundPlan;
		return rest;
	}

	/** Save the plan a moment after the last change. */
	changed() {
		const target = this.target;
		if (!target) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saving = true;
		const plan = () => this.planToSave();
		this.pending = async () => {
			this.pending = null;
			try {
				const result = await this.send({ action: 'save', cut_id: target.cutId, version: target.version, expected_version: this.project?.version, plan: plan() });
				this.adopt(result.data as Project);
			} catch (cause) { this.error = cause instanceof Error ? cause.message : 'Saving the sound plan failed'; }
			finally { this.saving = false; }
		};
		this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.pending?.(); }, 400);
	}

	private async flush() {
		if (!this.saveTimer) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = null;
		await this.pending?.();
	}

	setLayer(layer: Layer, patch: Partial<SoundPlan['layers'][Layer]>) {
		this.plan.layers[layer] = { ...this.plan.layers[layer], ...patch };
		this.changed();
	}

	private async upload(file: File | undefined): Promise<{ url: string; name: string } | null> {
		const project = this.project;
		if (!file || !project) return null;
		const response = await fetch(`/api/projects/${project.project_id}/sound?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type || 'audio/*' }, body: file });
		const result = (await response.json()) as Answer<{ url: string; name: string }>;
		if (!result.ok) { this.error = result.error.message; return null; }
		return result.data;
	}

	async setAmbience(file: File | undefined) {
		const stored = await this.upload(file);
		if (!stored) return;
		this.plan.ambience = stored;
		this.changed();
	}

	removeAmbience() {
		this.plan.ambience = undefined;
		this.changed();
	}

	async addEffect(file: File | undefined, at_s: number) {
		const stored = await this.upload(file);
		if (!stored) return;
		this.plan.effects = [...this.plan.effects, { effect_id: crypto.randomUUID(), ...stored, at_s: Math.max(0, at_s), gain_db: 0 }].sort((a, b) => a.at_s - b.at_s);
		this.changed();
	}

	setEffect(id: string, patch: { at_s?: number; gain_db?: number }) {
		this.plan.effects = this.plan.effects.map((effect) => (effect.effect_id === id ? { ...effect, ...patch } : effect)).sort((a, b) => a.at_s - b.at_s);
		this.changed();
	}

	keepEffect(id: string) {
		this.plan.effects = this.plan.effects.map((effect) => (effect.effect_id === id ? { ...effect, suggested: false } : effect));
		this.changed();
	}

	removeEffect(id: string) {
		this.plan.effects = this.plan.effects.filter((effect) => effect.effect_id !== id);
		this.changed();
	}

	setFlow(flow: SoundPlan['music_flow']) {
		this.plan.music_flow = flow;
		this.changed();
	}

	setMix(patch: Partial<Pick<SoundPlan, 'crossfade_s' | 'duck_db' | 'limiter_db'>>) {
		Object.assign(this.plan, patch);
		this.changed();
	}

	async build() {
		const target = this.target;
		if (!target) return;
		this.building = true; this.error = null;
		try {
			await this.flush();
			const result = await this.send({ action: 'build', cut_id: target.cutId, version: target.version });
			this.adopt(result.data as Project);
		} catch (cause) { this.error = cause instanceof Error ? cause.message : 'Building the mix failed'; }
		finally { this.building = false; }
	}

	/** The Agent's effects pass: suggestions from the effects folder, and offers to generate that need a priced OK. */
	async propose() {
		const target = this.target;
		if (!target) return;
		this.proposing = true; this.error = null; this.proposeNote = null;
		try {
			await this.flush();
			const result = await this.send({ action: 'propose', cut_id: target.cutId, version: target.version }) as unknown as { data: Project; offers: EffectOffer[]; dropped: string[]; moments: number };
			this.adopt(result.data);
			this.offers = result.offers;
			const suggested = (cutsOf(result.data.production).find((c) => c.cut_id === target.cutId)?.versions?.find((v) => v.version === target.version)?.sound?.effects ?? []).filter((e) => e.suggested).length;
			this.proposeNote = `I looked at ${result.moments} moments in v${target.version}: ${suggested} ${suggested === 1 ? 'effect' : 'effects'} from your folder fit, and ${result.offers.length} I would have to generate.${result.dropped.length ? ` ${result.dropped.length} of my picks were discarded (${result.dropped.join('; ')}).` : ''}`;
		} catch (cause) { this.error = cause instanceof Error ? cause.message : 'The effects pass failed'; }
		finally { this.proposing = false; }
	}

	async priceOffer(offer: EffectOffer) {
		offer.busy = true;
		try {
			const result = await this.send<{ credits: number }>({ action: 'quote_effect', prompt: offer.prompt, duration_s: offer.duration_s });
			offer.credits = (result.data as { credits: number }).credits;
			offer.confirming = true;
		} catch (cause) { this.error = cause instanceof Error ? cause.message : 'Price check failed'; }
		finally { offer.busy = false; }
	}

	/** Spends credits: only from the button that shows the price. */
	async generateOffer(offer: EffectOffer) {
		const target = this.target;
		if (!target || offer.credits === undefined) return;
		offer.busy = true;
		try {
			await this.flush();
			const result = await this.send({ action: 'generate_effect', cut_id: target.cutId, version: target.version, prompt: offer.prompt, duration_s: offer.duration_s, at_s: offer.at_s, confirmed_credits: offer.credits });
			this.adopt(result.data as Project);
			this.offers = this.offers.filter((o) => o !== offer);
		} catch (cause) { this.error = cause instanceof Error ? cause.message : 'Generating the effect failed'; offer.busy = false; }
	}

	skipOffer(offer: EffectOffer) {
		this.offers = this.offers.filter((o) => o !== offer);
	}
}

export const soundDesk = new SoundDesk();
