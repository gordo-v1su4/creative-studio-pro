import type { Project, StageId, GateHistoryEntry } from '$lib/domain/schemas';

/**
 * super-seed2 gate engine (AD-7, FR-003/FR-004): the one module that owns
 * stage order, legal actions, and force-advance. Stage names come from the
 * vendored methodology contract (METHODOLOGY-CONTRACT.md); no stage skipping.
 */

export const STAGES: ReadonlyArray<{ id: StageId; name: string }> = [
	{ id: 'S0', name: 'Intake' },
	{ id: 'S1', name: 'Interview' },
	{ id: 'S2', name: 'Brief' },
	{ id: 'S3', name: 'Story spine' },
	{ id: 'S4', name: 'Layout' },
	{ id: 'S5', name: 'Vibe check' },
	{ id: 'S6', name: 'Asset registry' },
	{ id: 'S7', name: 'LIRA' },
	{ id: 'S8', name: 'Prompt pack' },
	{ id: 'S9', name: 'Generate' },
	{ id: 'S10', name: 'Assemble' }
] as const;

/** Advance thresholds from the methodology contract. */
export const ADVANCE_CONFIDENCE_OVERALL = 80;
export const ADVANCE_CONFIDENCE_DIMENSION_FLOOR = 70;

export function stageIndex(id: StageId): number {
	return STAGES.findIndex((s) => s.id === id);
}

export function stageName(id: StageId): string {
	return STAGES.find((s) => s.id === id)?.name ?? id;
}

export function nextStageId(id: StageId): StageId | null {
	const index = stageIndex(id);
	if (index < 0 || index >= STAGES.length - 1) return null;
	return STAGES[index + 1].id;
}

/**
 * Legal actions per stage state (EXPERIENCE.md state table). Generation stays
 * blocked before gates pass; only the operator sees Force advance.
 */
export function legalActions(project: Project): string[] {
	switch (project.stage.state) {
		case 'BLOCKED':
			return ['Inspect gaps', 'Answer questions'];
		case 'READY FOR REVIEW':
			return ['Review', 'Approve', 'Reject'];
		case 'PASSED':
			return ['Enter next stage'];
		case 'FORCED':
			return ['Continue with rework warning'];
	}
}

export type ForceAdvanceInput = {
	reason: string;
	operator: string;
	now: string;
};

export type ForceAdvanceResult =
	| { ok: true; project: Project }
	| { ok: false; code: 'AT_FINAL_STAGE'; message: string };

/**
 * Operator-only force-advance (FR-004): moves exactly one stage forward,
 * records stage, reason, prior confidence, operator, and timestamp in the
 * append-only gate history. Confidence resets to null — the new stage has
 * not been evaluated and no value may be fabricated (NFR-002).
 */
export function applyForceAdvance(
	project: Project,
	input: ForceAdvanceInput
): ForceAdvanceResult {
	const from = project.stage.id;
	const to = nextStageId(from);
	if (!to) {
		return {
			ok: false,
			code: 'AT_FINAL_STAGE',
			message: `Project is at ${from} (${stageName(from)}); there is no later stage to advance to`
		};
	}
	const entry: GateHistoryEntry = {
		event: 'force_advance',
		from_stage: from,
		to_stage: to,
		reason: input.reason,
		prior_confidence: project.stage.confidence,
		operator: input.operator,
		timestamp: input.now
	};
	return {
		ok: true,
		project: {
			...project,
			stage: { id: to, state: 'FORCED', confidence: null },
			gate_history: [...project.gate_history, entry]
		}
	};
}
