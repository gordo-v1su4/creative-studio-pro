import type { BriefVersion, Project } from '$lib/domain/schemas';
import type { ProposeLevel } from '$lib/domain/story-propose';
import { DEFAULT_TARGET, type TeaserTarget } from '$lib/domain/trailer-house';
import type { DriftChoice, DriftItem, DriftReport, RenameChoice } from '$lib/domain/drift';
import { batchAnswer, type BatchEvent } from '$lib/domain/drift-batch';
import { ui } from '$lib/ui/app-state.svelte';

/**
 * The Agent's actions on the way from an idea to a story plan (decision 18): pitch three loglines, three more,
 * pick one, quick teaser, draft the brief, propose a level. They are the same wherever they are pressed (the
 * story plan, the pitch, the Agent's dock), and every one says what it is doing and what came of it, so the
 * operator is told rather than asked (story 6). Each calls the model; none of them saves an approval or spends
 * on a render.
 */

/** Drift 08: where an undersized picture's upscale stands in the chat, by drift item key. */
export type PictureSide = { url: string; width: number; height: number };
export type PictureStep =
	| { stage: 'priced'; credits: number }
	| { stage: 'upscaling'; credits: number }
	| { stage: 'back'; original: PictureSide; upscaled: PictureSide }
	| { stage: 'sent'; upscaled: PictureSide };

export type BriefFields = Pick<BriefVersion, 'title' | 'logline' | 'format' | 'tone_visual_rules' | 'must_haves' | 'must_nots' | 'success_criteria'>;
export type AgentLine = { id: number; projectId: string; text: string; state: 'doing' | 'done' | 'failed' };
export type TeaserIssue = { rule: string; severity: 'error' | 'warning'; match: string; message: string };
type Answer<T> = ({ ok: true; data: T } & Record<string, unknown>) | { ok: false; error?: { message?: string } };

const LEVEL_WORDS: Record<ProposeLevel, { the: string; one: string; many: string }> = {
	acts: { the: 'the acts', one: 'act', many: 'acts' },
	scenes: { the: 'the scenes', one: 'scene', many: 'scenes' },
	beats: { the: 'the story beats', one: 'story beat', many: 'story beats' },
	shots: { the: 'the shots', one: 'shot', many: 'shots' }
};

class AgentWork {
	/** What the Agent has said it is doing, newest last. */
	lines = $state<AgentLine[]>([]);
	/** The action running now ("pitch", "brief", "teaser", "propose:scenes"…), one at a time. */
	busy = $state<string | null>(null);
	/** A brief the Agent drafted, waiting for the brief sheet to show it. Nothing is saved until the operator saves. */
	briefDraft = $state<{ projectId: string; fields: BriefFields } | null>(null);
	/** The quick teaser while it is being written: what the Agent is doing and what the check still finds. */
	teaser = $state<{ projectId: string; status: string; title: string | null; issues: TeaserIssue[] } | null>(null);
	/** The last drift check's report (Drift 03), posted as one Agent message; null when it found nothing. */
	drift = $state<{ projectId: string; report: DriftReport } | null>(null);
	/** Where each of a project's Prep references stood at the last check (Drift 09), clean or not; Prep shows it. */
	standing = $state<DriftReport['standing'] | null>(null);
	/** Drift 08: each undersized picture's step (price shown, upscaling, back beside the original, sent). */
	pictures = $state<Record<string, PictureStep>>({});
	/** Drift 08: "remake" asks for this project's Prep to open; the page takes it once. */
	openPrep = $state<string | null>(null);
	private next = 1;

	linesFor(projectId: string): AgentLine[] { return this.lines.filter((line) => line.projectId === projectId).slice(-12); }

	private say(projectId: string, text: string): number {
		const id = this.next++;
		this.lines = [...this.lines.slice(-40), { id, projectId, text, state: 'doing' }];
		return id;
	}
	private settle(id: number, text: string, state: 'done' | 'failed') {
		this.lines = this.lines.map((line) => (line.id === id ? { ...line, text, state } : line));
	}

	/** One action at a time: say it, do it, say what came of it. Resolves to the project it left, or null. */
	private async run(project: Project, key: string, doing: string, work: () => Promise<{ project: Project | null; said: string }>): Promise<Project | null> {
		if (this.busy) return null;
		this.busy = key;
		const line = this.say(project.project_id, doing);
		try {
			const { project: next, said } = await work();
			this.settle(line, said, 'done');
			if (next) ui.adoptActiveProject(next);
			return next ?? project;
		} catch (cause) {
			this.settle(line, cause instanceof Error ? cause.message : 'The Agent could not do that', 'failed');
			return null;
		} finally { this.busy = null; }
	}

	private async post<T>(url: string, body?: Record<string, unknown>): Promise<Answer<T> & { ok: true }> {
		const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
		const text = await response.text();
		let answer: Answer<T>;
		// A server in front of the app can replace a failed answer with its own page; say so plainly.
		try { answer = JSON.parse(text) as Answer<T>; } catch { throw new Error(`The Agent could not be reached (HTTP ${response.status})`); }
		if (!answer.ok) throw new Error(answer.error?.message ?? 'The Agent could not do that');
		return answer;
	}

	/**
	 * "What's out of step?" (Drift 03, ADR 0012): compares Notion's References, every project's Prep and Review
	 * Room's reference folders. It only reads. Anything out of step is posted as one message; a clean check is the
	 * one line saying it checked.
	 */
	checkDrift(project: Project): Promise<Project | null> {
		return this.run(project, 'drift', 'Checking Notion, Prep and Review Room…', async () => {
			const response = await fetch(`/api/projects/${project.project_id}/drift`);
			const answer = (await response.json().catch(() => null)) as Answer<DriftReport> | null;
			if (!answer) throw new Error(`The Agent could not be reached (HTTP ${response.status})`);
			if (!answer.ok) throw new Error(answer.error?.message ?? 'The check could not run');
			return { project: null, said: this.take(project.project_id, answer.data) };
		});
	}

	/** Keeps a check's report: one message when something is out of step, and what the one line says. */
	private take(projectId: string, report: DriftReport): string {
		const count = report.items.length;
		// A clean check of one project leaves another project's message as it was.
		if (count) this.drift = { projectId, report };
		else if (this.drift?.projectId === projectId) this.drift = null;
		this.standing = report.standing;
		const sheets = (report.read.sheets === null ? ' Review Room is not connected here, so its reference folders were not read.' : '') + (report.read.skipped.length ? ` The Prep of ${report.read.skipped.join(', ')} could not be read.` : '');
		return count ? `Checked Notion, Prep and Review Room.${sheets}` : `Checked Notion, Prep and Review Room: everything is in step.${sheets}`;
	}

	/**
	 * Reads the check again without a line of its own, after something here settled drift (an add from the Agent or
	 * from Prep), so Prep's standing and its "only in this project" count follow (Drift 09). A failed read changes nothing.
	 */
	async recheck(project: Project) {
		const answer = (await fetch(`/api/projects/${project.project_id}/drift`).then((response) => response.json()).catch(() => null)) as Answer<DriftReport> | null;
		if (answer?.ok) this.take(project.project_id, answer.data);
	}

	/**
	 * The check a series re-check or sync ran on the server (Drift 09): posted as if the Agent had run it, on the
	 * project it was run from, so the message is there when that project opens. Failed, it says why in one line.
	 */
	postDrift(projectId: string, result: { report: DriftReport } | { error: string }) {
		const line = this.say(projectId, 'Checking Notion, Prep and Review Room…');
		if ('error' in result) this.settle(line, `The drift check could not run: ${result.error}`, 'failed');
		else this.settle(line, this.take(projectId, result.report), 'done');
	}

	/** "Add to Notion" on a drift item: the Prep add (Drift 02) on the project it was found in, with the operator's name. */
	addToNotion(project: Project, item: DriftItem, name: string): Promise<Project | null> {
		const at = item.found.prep[0];
		return this.run(project, `drift:${item.key}`, `Adding ${name} to Notion…`, async () => {
			if (!at) throw new Error(`${name} is not in any Prep, so it cannot be added from here yet`);
			await this.post<unknown>(`/api/projects/${at.project_id}/prep`, { action: 'add_entry', kind: item.kind, name, former_names: item.spellings });
			this.settleDrift(project.project_id, item.key);
			await this.recheck(project);
			return { project: null, said: `${name} is in Notion's References now, and in ${at.project_title}'s Prep.` };
		});
	}

	/** "Mark as old" on a Review Room sheet (Drift 04): flagged as history in Review Room, optionally of a Notion reference, and never offered again. */
	markOld(project: Project, item: DriftItem, historyOf: { page_id: string; name: string } | null): Promise<Project | null> {
		const sheet = item.found.review_room;
		return this.run(project, `drift:${item.key}`, `Marking ${sheet?.code ?? item.name} as old in Review Room…`, async () => {
			if (!sheet) throw new Error(`${item.name} has no sheet in Review Room to mark old`);
			await this.post<unknown>(`/api/projects/${project.project_id}/drift`, { choice: 'mark_old', asset_id: sheet.asset_id, history_of: historyOf?.page_id ?? null });
			this.settleDrift(project.project_id, item.key);
			return { project: null, said: `${sheet.code} is marked old in Review Room${historyOf ? `, as ${historyOf.name}'s history` : ''}. It stays there, but is not offered for a shot or checked again.` };
		});
	}

	/**
	 * A rename in Notion (Drift 06, ADR 0012): put the name the sheets carry back in Notion (only its Name is
	 * written), or make it a new reference (Notion keeps the new name, the old sheets become its history, and its
	 * next send makes the new code and sheet). The app never renames a coded reference.
	 */
	answerRename(project: Project, item: DriftItem, choice: RenameChoice): Promise<Project | null> {
		const renamed = item.renamed;
		const doing = !renamed ? `Answering ${item.name}…` : choice === 'restore_name' ? `Putting ${renamed.from} back as the name in Notion…` : `Making ${renamed.to} a new reference, and marking ${renamed.from}'s ${renamed.sheets.length === 1 ? 'sheet' : 'sheets'} old…`;
		return this.run(project, `drift:${item.key}`, doing, async () => {
			if (!renamed) throw new Error(`${item.name} is not a rename in Notion`);
			const answer = await this.post<{ marked: string[] }>(`/api/projects/${project.project_id}/drift`, { choice, page_id: renamed.page_id });
			const marked = answer.data?.marked ?? [];
			this.settleDrift(project.project_id, item.key);
			await this.recheck(project);
			return {
				project: null,
				said: choice === 'restore_name'
					? `${renamed.from} is the name in Notion again, so it matches its sheet.`
					: `${renamed.to} is a new reference: ${marked.join(', ')} ${marked.length === 1 ? 'is' : 'are'} old now, as its history, and Prep has it waiting for a sheet under the new name.`
			};
		});
	}

	/** Drift 08: the price of upscaling a picture under 2K. It spends nothing; the upscale waits for a yes to this price. */
	priceUpscale(project: Project, item: DriftItem): Promise<Project | null> {
		const picture = item.picture;
		return this.run(project, `drift:${item.key}`, `Asking the price of upscaling ${item.name}…`, async () => {
			if (!picture) throw new Error(`${item.name} has no picture to upscale`);
			// An upscale already made (asked for before a reload) is shown again rather than priced and paid for twice.
			const earlier = await this.post<{ pending: boolean; original?: PictureSide; upscaled?: PictureSide }>(`/api/projects/${picture.project_id}/drift`, { action: 'settle_upscale', key: picture.entry_key }).catch(() => null);
			if (earlier?.data.pending) throw new Error(`${item.name} is already being upscaled; run the check again in a minute to see it`);
			if (earlier?.data.original && earlier.data.upscaled) {
				this.pictures = { ...this.pictures, [item.key]: { stage: 'back', original: earlier.data.original, upscaled: earlier.data.upscaled } };
				return { project: null, said: `${item.name} was upscaled already. Look at it beside the original, then send it or remake it.` };
			}
			const answer = await this.post<{ quote: { credits: number } }>(`/api/projects/${picture.project_id}/drift`, { action: 'quote_upscale', key: picture.entry_key });
			const credits = answer.data.quote.credits;
			this.pictures = { ...this.pictures, [item.key]: { stage: 'priced', credits } };
			return { project: null, said: `Upscaling ${item.name} to 2048 px costs ${credits} credit${credits === 1 ? '' : 's'}. Nothing is spent until you say yes.` };
		});
	}

	/**
	 * The operator's words as one answer for several drift items ("add all six", "add the locations"). True when they
	 * were one, whether or not it could run (a count that does not match says so and writes nothing).
	 */
	answerWords(project: Project, text: string): boolean {
		const report = this.drift?.projectId === project.project_id ? this.drift.report : null;
		const answer = report ? batchAnswer(text, report.items) : null;
		if (!report || !answer) return false;
		if (this.busy) { this.settle(this.say(project.project_id, text.trim()), 'The Agent is still working; say it again when it is done.', 'failed'); return true; }
		if (!answer.ok) { const line = this.say(project.project_id, text.trim()); this.settle(line, answer.message, 'failed'); return true; }
		const items = answer.keys.map((key) => report.items.find((item) => item.key === key)!);
		void this.answerMany(project, items, answer.choice);
		return true;
	}

	/** A drift item that is answered leaves the message. */
	private settleDrift(projectId: string, key: string) {
		if (this.drift?.projectId !== projectId) return;
		const items = this.drift.report.items.filter((entry) => entry.key !== key);
		this.drift = items.length ? { ...this.drift, report: { ...this.drift.report, items } } : null;
	}

	/**
	 * One answer for several drift items (Drift 10, GitHub #38 / V1S-514): "add all six", or a press on a group. The
	 * server writes the first alone and checks it in Notion before the rest; every write is said here as it runs and
	 * as it ends, and a failure stops the batch there and says why. Each item keeps the name the check proposed.
	 */
	answerMany(project: Project, items: DriftItem[], choice: DriftChoice = 'add_to_notion'): Promise<Project | null> {
		const count = items.length;
		const doing = count === 1 ? `Adding ${items[0].name} to Notion…` : `Adding ${count} to Notion, one at a time: the first alone, checked before the rest…`;
		return this.run(project, 'drift:batch', doing, async () => {
			const answers = items.map((item) => ({ key: item.key, choice, kind: item.kind, name: item.name, project_id: item.found.prep[0].project_id, former_names: item.spellings.slice(0, 10) }));
			const response = await fetch(`/api/projects/${project.project_id}/drift`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers }) });
			if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) {
				const failed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
				throw new Error(failed?.error?.message ?? `The Agent could not be reached (HTTP ${response.status})`);
			}
			const open = new Map<string, number>();
			let end: { ok: boolean; done?: string[]; untouched?: string[] } | null = null;
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
					const text = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
					if (!text.trim()) continue;
					const event = JSON.parse(text) as ({ type: 'line' } & BatchEvent) | { type: 'end'; ok: boolean; done?: string[]; untouched?: string[] };
					if (event.type === 'end') { end = event; continue; }
					if (event.state === 'doing') { open.set(event.key, this.say(project.project_id, event.text)); continue; }
					const line = open.get(event.key);
					if (line !== undefined) this.settle(line, event.text, event.state);
					else this.settle(this.say(project.project_id, event.text), event.text, event.state);
					if (event.state === 'done' && !event.check) this.settleDrift(project.project_id, event.key);
				}
			}
			// What was added settles drift, so Prep's standing and its count follow (Drift 09).
			await this.recheck(project);
			if (!end) throw new Error('Adding stopped without saying how far it got; ask what is out of step again');
			// The line above already says why; this one says how far it got.
			if (!end.ok) throw new Error(`Stopped: ${end.done?.length ?? 0} added, ${end.untouched?.length ?? 0} not touched.`);
			return { project: null, said: count === 1 ? 'Done.' : `All ${count} are in Notion's References now, each in the Prep it was found in.` };
		});
	}

	/**
	 * Drift 08: the upscale, once the operator said yes to its price. The spend itself is `confirm`, posted from the
	 * operator's own press (decision 17: the Agent never confirms a spend); the Agent says it, then waits for the
	 * sheet to come back and shows it beside the original.
	 */
	async upscale(project: Project, item: DriftItem, credits: number, confirm: () => Promise<void>): Promise<Project | null> {
		const picture = item.picture;
		if (!picture) return null;
		const url = `/api/projects/${picture.project_id}/drift`;
		const started = await this.run(project, `drift:${item.key}`, `Upscaling ${item.name} for ${credits} credit${credits === 1 ? '' : 's'}…`, async () => {
			await confirm();
			this.pictures = { ...this.pictures, [item.key]: { stage: 'upscaling', credits } };
			return { project: null, said: `${item.name} is being upscaled. It comes back here beside the original before anything is sent.` };
		});
		if (!started) return null;
		// Waiting holds no other action back: it has its own line, and the Agent stays free.
		const line = this.say(project.project_id, `Waiting for ${item.name} to come back…`);
		try {
			for (let tries = 0; tries < 120; tries++) {
				const answer = await this.post<{ pending: boolean; original?: PictureSide; upscaled?: PictureSide }>(url, { action: 'settle_upscale', key: picture.entry_key });
				if (!answer.data.pending && answer.data.original && answer.data.upscaled) {
					this.pictures = { ...this.pictures, [item.key]: { stage: 'back', original: answer.data.original, upscaled: answer.data.upscaled } };
					this.settle(line, `${item.name} is back at ${answer.data.upscaled.width}×${answer.data.upscaled.height}. Look at it beside the original, then send it or remake it.`, 'done');
					return started;
				}
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
			this.settle(line, `${item.name} has not come back after ten minutes; run the check again later to see it`, 'failed');
		} catch (cause) {
			// A failed job is cleared on the server and can be asked for again; anything else keeps the job, so the next press picks it up.
			const { [item.key]: _gone, ...rest } = this.pictures;
			this.pictures = rest;
			this.settle(line, `${cause instanceof Error ? cause.message : `${item.name} did not come back`} Press Upscale again to see where it stands; a job already paid for is not sent twice.`, 'failed');
		}
		return null;
	}

	/** Drift 08: the upscaled sheet to Review Room, on the operator's yes after seeing it beside the original. */
	sendUpscaled(project: Project, item: DriftItem): Promise<Project | null> {
		const picture = item.picture;
		const step = this.pictures[item.key];
		return this.run(project, `drift:${item.key}`, `Sending ${item.name}'s upscaled sheet to Review Room…`, async () => {
			if (!picture || step?.stage !== 'back') throw new Error(`${item.name} has no upscaled sheet to send yet`);
			await this.post<unknown>(`/api/projects/${picture.project_id}/drift`, { action: 'send_upscaled', key: picture.entry_key });
			this.pictures = { ...this.pictures, [item.key]: { stage: 'sent', upscaled: step.upscaled } };
			return { project: null, said: `${item.name}'s upscaled sheet is in Review Room.` };
		});
	}

	/** Drift 08: "remake" opens Prep, where a new sheet is made with its own price first. It writes nothing. */
	remake(project: Project, item: DriftItem) {
		const at = item.picture?.project_id ?? project.project_id;
		const line = this.say(project.project_id, `Opening Prep to remake ${item.name}…`);
		// Only this project's Prep is opened, so a request for another project's never lingers.
		if (at === project.project_id) this.openPrep = at;
		this.settle(line, at === project.project_id ? `Remake ${item.name} in Prep; its new sheet is priced before anything is spent.` : `Remake ${item.name} in ${item.found.prep[0]?.project_title ?? 'its project'}'s Prep; its new sheet is priced before anything is spent.`, 'done');
	}

	/** Draft the brief from the idea, the pick or the story. It is shown for reading; nothing is saved. */
	draftBrief(project: Project): Promise<Project | null> {
		const from = project.trailer_house?.picked ? 'the logline you picked' : project.production.story_plan?.source && project.production.story_plan.source.title !== 'Starting idea' ? 'the story' : 'your idea';
		return this.run(project, 'brief', `Drafting the brief from ${from}…`, async () => {
			const answer = await this.post<BriefFields>(`/api/projects/${project.project_id}/brief/draft`);
			this.briefDraft = { projectId: project.project_id, fields: answer.data };
			return { project: null, said: 'The brief is drafted. Read it, change anything, then approve it.' };
		});
	}

	/** Three loglines to react to; asked again, three different ones. `direction` is what the operator said is off, or wants. */
	pitch(project: Project, direction?: string): Promise<Project | null> {
		const house = project.trailer_house;
		const base = house?.seeds ?? project.production.story_plan?.source?.text ?? project.seed.brief;
		// What the operator says is off is added to what the pitches grow from; it does not replace it.
		const seeds = (direction?.trim() ? `${base}\n\nWhat was off about the last pitches: ${direction.trim()}`.trim() : base).slice(0, 5000);
		const again = !!house?.rounds.length;
		return this.run(project, 'pitch', again ? 'Pitching three more…' : 'Pitching three loglines…', async () => {
			const answer = await this.post<Project>(`/api/projects/${project.project_id}/trailer-house`, { action: 'pitch', expected_version: project.version, seeds, character: house?.character ?? '', target: house?.target ?? DEFAULT_TARGET });
			return { project: answer.data, said: again ? 'Three more. Pick one, or say what is off.' : 'Three ways to play it. Pick one, or ask for three more.' };
		});
	}

	/** "Make this": the pick becomes the logline; then the Agent drafts the brief from it, unasked. */
	async pick(project: Project, round: number, index: number): Promise<Project | null> {
		const picked = await this.run(project, 'pick', 'Taking that one…', async () => {
			const answer = await this.post<Project>(`/api/projects/${project.project_id}/trailer-house`, { action: 'pick', expected_version: project.version, round, index });
			return { project: answer.data, said: 'That is the one. Next: its brief, and a quick teaser if you want to see it first.' };
		});
		if (picked) await this.draftBrief(picked);
		return picked;
	}

	/** The quick teaser of a pitch: one prompt, written and checked. Rendering it is a separate, priced step. */
	teaserFor(project: Project, round: number, index: number, target: TeaserTarget): Promise<Project | null> {
		return this.run(project, 'teaser', 'Writing the quick teaser…', async () => {
			this.teaser = { projectId: project.project_id, status: 'Starting…', title: null, issues: [] };
			try {
				const response = await fetch(`/api/projects/${project.project_id}/trailer-house`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'develop', expected_version: project.version, round, index, character: project.trailer_house?.character ?? '', target }) });
				if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) {
					const failed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
					throw new Error(failed?.error?.message ?? `The Agent could not be reached (HTTP ${response.status})`);
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '', done: Project | null = null, failure = '';
				for (;;) {
					const { value, done: ended } = await reader.read();
					if (ended) break;
					buffer += decoder.decode(value, { stream: true });
					for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
						const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
						if (!line.trim() || !this.teaser) continue;
						const event = JSON.parse(line) as { type: string; [key: string]: unknown };
						if (event.type === 'status') this.teaser.status = String(event.text);
						else if (event.type === 'teaser') this.teaser.title = (event.blueprint as { title: string }).title;
						else if (event.type === 'lint') this.teaser.issues = event.issues as TeaserIssue[];
						else if (event.type === 'done') done = event.data as Project;
						else if (event.type === 'error') failure = String(event.message);
					}
				}
				if (failure || !done) throw new Error(failure || 'The teaser did not come back');
				const left = done.trailer_house?.blueprint?.lint?.remaining.filter((issue) => issue.severity === 'error').length ?? 0;
				return { project: done, said: left ? `The teaser is written; the check still finds ${left} thing${left === 1 ? '' : 's'}. Get its price when you are ready.` : 'The teaser is written and passes the check. Get its price when you are ready.' };
			} finally { this.teaser = null; }
		});
	}

	/** Propose one level of the story plan. It fills what is empty and never touches what is there. */
	propose(project: Project, level: ProposeLevel, targetSeconds?: number): Promise<Project | null> {
		const words = LEVEL_WORDS[level];
		return this.run(project, `propose:${level}`, `Proposing ${words.the}…`, async () => {
			const answer = await this.post<Project>(`/api/projects/${project.project_id}/plan`, { action: 'propose', expected_version: project.version, level, ...(targetSeconds ? { target_s: targetSeconds } : {}) });
			const added = Number(answer.added ?? 0);
			return { project: answer.data, said: `${added} ${added === 1 ? words.one : words.many} proposed. Read ${added === 1 ? 'it' : 'them'}, change anything, then approve.` };
		});
	}
}

export const agentWork = new AgentWork();
