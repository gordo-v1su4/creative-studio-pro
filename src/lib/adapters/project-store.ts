import { mkdir, readdir, readFile, appendFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, ProjectSummary, CanvasLayout, LedgerEvent } from '$lib/domain/schemas';
import {
	ledgerEventSchema,
	projectSchema,
	canvasLayoutSchema
} from '$lib/domain/schemas';
import { idSchema } from '$lib/domain/schemas';
import { uuid7ish } from '$lib/domain/ids';

type LedgerEventType = LedgerEvent['type'];

/**
 * Project store adapter (AD-2): one project folder owns canonical append-only
 * JSONL records plus a separate canvas-layout document (AD-3). The index is
 * disposable and rebuilt on read.
 */

export interface ProjectStoreConfig {
	/** Absolute project root; environment-injected (AD-14). */
	root: string;
}

const LEDGER = 'ledger.jsonl';
const LAYOUT = 'canvas-layout.json';

export class ProjectStore {
	private readonly root: string;
	private readonly projectLocks = new Map<string, Promise<void>>();

	constructor(config: ProjectStoreConfig) {
		this.root = config.root;
	}

	private projectDir(projectId: string): string {
		return join(this.root, idSchema.parse(projectId));
	}

	private async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.projectLocks.get(projectId) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const tail = previous.then(() => gate);
		this.projectLocks.set(projectId, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.projectLocks.get(projectId) === tail) this.projectLocks.delete(projectId);
		}
	}

	private async ensureRoot(): Promise<void> {
		await mkdir(this.root, { recursive: true });
	}

	/**
	 * Rebuild project state by folding the append-only ledger. Canonical
	 * records never depend on index survival (NFR-003).
	 */
	async readProject(projectId: string): Promise<Project | null> {
		const dir = this.projectDir(projectId);
		let content: string;
		try {
			content = await readFile(join(dir, LEDGER), 'utf8');
		} catch {
			return null;
		}
		let project: Project | null = null;
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parsed = ledgerEventSchema.safeParse(JSON.parse(trimmed));
			if (!parsed.success) {
				// Unknown event versions fail closed (AD-4): stop folding at the
				// first record we cannot interpret.
				throw new Error(
					`Uninterpretable ledger record in project ${projectId}: ${parsed.error.issues[0]?.message ?? 'unknown'}`
				);
			}
			project = parsed.data.payload;
		}
		if (!project) return null;
		return projectSchema.parse(project);
	}

	async listProjects(): Promise<ProjectSummary[]> {
		await this.ensureRoot();
		let entries: string[];
		try {
			entries = await readdir(this.root);
		} catch {
			return [];
		}
		const summaries: ProjectSummary[] = [];
		for (const entry of entries) {
			const dir = join(this.root, entry);
			try {
				const s = await stat(join(dir, LEDGER));
				if (!s.isFile()) continue;
			} catch {
				continue;
			}
			const project = await this.readProject(entry);
			if (project) {
				summaries.push({
					schema_version: 1,
					project_id: project.project_id,
					title: project.title,
					stage_id: project.stage.id,
					stage_state: project.stage.state,
					updated_at: project.updated_at,
					version: project.version
				});
			}
		}
		summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
		return summaries;
	}

	async createProject(input: {
		title: string;
		brief: string;
		creative_focus: Project['seed']['creative_focus'];
		created_by: string;
	}): Promise<Project> {
		await this.ensureRoot();
		const now = new Date().toISOString();
		const project: Project = {
			schema_version: 1,
			project_id: uuid7ish(),
			title: input.title,
			created_at: now,
			updated_at: now,
			version: 0,
			stage: { id: 'S0', state: 'BLOCKED', confidence: null },
			gate_history: [],
			interview: { status: 'BLOCKED', rounds: [] },
			brief_state: { versions: [], current_version: null },
			approval_history: [],
			catalog_snapshot: null,
			creative_room: null,
			voices: [],
			trailer_house: null,
			production: { status: 'empty', title: '', logline: '', premise: '', theme: '', cards: [], assets: [], updated_at: null },
			agent_model: { override: null, locked_at: null, history: [] },
			seed: {
				seed_id: uuid7ish(),
				title: input.title,
				brief: input.brief,
				creative_focus: input.creative_focus,
				created_by: input.created_by
			}
		};
		const dir = this.projectDir(project.project_id);
		await mkdir(dir, { recursive: true });
		const event: LedgerEvent = {
			type: 'project.created.v1',
			event_id: uuid7ish(),
			project_id: project.project_id,
			timestamp: now,
			payload: project
		};
		await appendFile(join(dir, LEDGER), JSON.stringify(event) + '\n', 'utf8');
		// Initial layout: one seed node centered in the first viewport.
		const layout: CanvasLayout = {
			schema_version: 1,
			project_id: project.project_id,
			nodes: [
				{
					node_id: project.seed.seed_id,
					type: 'seed',
					lane: 'seeds',
					x: 0,
					y: 0,
					width: 320,
					height: 400
				}
			],
			viewport: { x: 0, y: 0, zoom: 1 },
			updated_at: now
		};
		await writeFile(
			join(dir, LAYOUT),
			JSON.stringify(layout, null, '\t') + '\n',
			'utf8'
		);
		return project;
	}

	/**
	 * Single mutation gateway (AD-3): version precondition checked, atomic
	 * append, returned version.
	 */
	async updateProject(
		projectId: string,
		expectedVersion: number,
		mutate: (project: Project) => Project,
		eventType: LedgerEventType = 'project.updated.v1'
	): Promise<Project> {
		return this.withProjectLock(idSchema.parse(projectId), async () => {
		const current = await this.readProject(projectId);
		if (!current) {
			throw new Error(`Project ${projectId} not found`);
		}
		if (current.version !== expectedVersion) {
			throw new Error(
				`Version conflict: expected ${expectedVersion}, current ${current.version}`
			);
		}
		const next = projectSchema.parse({
			...mutate(structuredClone(current)),
			version: current.version + 1,
			updated_at: new Date().toISOString()
		});
		// Every event type shares this shape; past 25 members TypeScript can't match a union-typed tag itself.
		const event = {
			type: eventType,
			event_id: uuid7ish(),
			project_id: projectId,
			timestamp: next.updated_at,
			payload: next
		} as LedgerEvent;
		await appendFile(join(this.projectDir(projectId), LEDGER), JSON.stringify(event) + '\n', 'utf8');
		return next;
		});
	}

	async readCanvasLayout(projectId: string): Promise<CanvasLayout | null> {
		try {
			const content = await readFile(join(this.projectDir(projectId), LAYOUT), 'utf8');
			return canvasLayoutSchema.parse(JSON.parse(content));
		} catch {
			return null;
		}
	}

	/**
	 * Canvas layout is a separate low-contention document: last-writer-wins,
	 * no aggregate version precondition, never canonical domain/audit records.
	 */
	async writeCanvasLayout(projectId: string, layout: CanvasLayout): Promise<CanvasLayout> {
		const next = canvasLayoutSchema.parse({
			...layout,
			project_id: projectId,
			updated_at: new Date().toISOString()
		});
		await writeFile(
			join(this.projectDir(projectId), LAYOUT),
			JSON.stringify(next, null, '\t') + '\n',
			'utf8'
		);
		return next;
	}
}
