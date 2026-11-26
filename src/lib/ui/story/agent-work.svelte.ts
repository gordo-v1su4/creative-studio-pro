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
			if (this.drift?.projectId === project.project_id) {
				const items = this.drift.report.items.filter((entry) => entry.key !== item.key);
				this.drift = items.length ? { ...this.drift, report: { ...this.drift.report, items } } : null;
			}
			await this.recheck(project);
			return { project: null, said: `${name} is in Notion's References now, and in ${at.project_title}'s Prep.` };
		});
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
