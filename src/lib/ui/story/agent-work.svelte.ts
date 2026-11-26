import type { BriefVersion, Project } from '$lib/domain/schemas';
import type { ProposeLevel } from '$lib/domain/story-propose';
import { DEFAULT_TARGET, type TeaserTarget } from '$lib/domain/trailer-house';
import type { DriftItem, DriftReport } from '$lib/domain/drift';
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
			const report = answer.data;
			const count = report.items.length;
			this.drift = count ? { projectId: project.project_id, report } : null;
			const sheets = (report.read.sheets === null ? ' Review Room is not connected here, so its reference folders were not read.' : '') + (report.read.skipped.length ? ` The Prep of ${report.read.skipped.join(', ')} could not be read.` : '');
			return { project: null, said: count ? `Checked Notion, Prep and Review Room.${sheets}` : `Checked Notion, Prep and Review Room: everything is in step.${sheets}` };
		});
	}

	/** "Add to Notion" on a drift item: the Prep add (Drift 02) on the project it was found in, with the operator's name. */
	addToNotion(project: Project, item: DriftItem, name: string): Promise<Project | null> {
		const at = item.found.prep[0];
		return this.run(project, `drift:${item.key}`, `Adding ${name} to Notion…`, async () => {
			if (!at) throw new Error(`${name} is not in any Prep, so it cannot be added from here yet`);
			await this.post<unknown>(`/api/projects/${at.project_id}/prep`, { action: 'add_entry', kind: item.kind, name, former_names: item.spellings });
			if (this.drift?.projectId === project.project_id) {
				const items = this.drift.report.items.filter((entry) => entry.key !== item.key);
				this.drift = items.length ? { ...this.drift, report: { ...this.drift.report, items } } : null;
			}
			return { project: null, said: `${name} is in Notion's References now, and in ${at.project_title}'s Prep.` };
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
