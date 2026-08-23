import type { Project, StageId, GateHistoryEntry, ConfidenceRound, BriefApproval } from '$lib/domain/schemas';
import { CONFIDENCE_DIMENSIONS } from '$lib/domain/schemas';

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
	| { ok: false; code: 'AT_FINAL_STAGE' | 'PROTECTED_STAGE'; message: string };

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
	if (from === 'S0' || from === 'S1' || from === 'S2') {
		return { ok: false, code: 'PROTECTED_STAGE', message: 'S1 interview and authenticated S2 brief lock cannot be skipped' };
	}
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

export function evaluateInterviewRound(input: Omit<ConfidenceRound, 'status'>): ConfidenceRound {
	const dimensions = new Set(input.scores.map((score) => score.dimension));
	if (dimensions.size !== CONFIDENCE_DIMENSIONS.length || CONFIDENCE_DIMENSIONS.some((dimension) => !dimensions.has(dimension))) {
		throw new Error('All eight confidence dimensions must be scored exactly once');
	}
	const minimum = Math.min(...input.scores.map((score) => score.score));
	const passes = input.overall >= ADVANCE_CONFIDENCE_OVERALL && minimum >= ADVANCE_CONFIDENCE_DIMENSION_FLOOR;
	const stalled = input.round_number >= 3 && input.overall < 60;
	return { ...input, status: passes ? 'PASSED' : stalled ? 'STALLED' : 'BLOCKED' };
}

export function applyInterviewRound(project: Project, round: ConfidenceRound): Project {
	if (project.stage.id !== 'S0' && project.stage.id !== 'S1') {
		throw new Error(`Interview rounds are illegal while project is at ${project.stage.id}`);
	}
	if (project.interview.status === 'STALLED') {
		throw new Error('Interview is STALLED; blockers require operator resolution before another round');
	}
	if (round.round_number !== project.interview.rounds.length + 1) {
		throw new Error(`Interview round must be ${project.interview.rounds.length + 1}`);
	}
	if (round.status === 'STALLED') {
		const missingBlockers = round.scores.filter((score) => score.score < ADVANCE_CONFIDENCE_DIMENSION_FLOOR && score.notes.trim().length === 0);
		if (missingBlockers.length > 0) {
			throw new Error(`STALLED round requires blocker notes for: ${missingBlockers.map((score) => score.dimension).join(', ')}`);
		}
	}
	return {
		...project,
		interview: { status: round.status, rounds: [...project.interview.rounds, round] },
		stage: round.status === 'PASSED'
			? { id: 'S2', state: 'BLOCKED', confidence: round.overall }
			: { id: 'S1', state: 'BLOCKED', confidence: round.overall }
	};
}

export function applyBriefLock(
	project: Project,
	input: { briefVersion: number; briefHash: string; operator: string; now: string }
): Project {
	if (project.interview.status !== 'PASSED' || project.stage.id !== 'S2') {
		throw new Error('S2 brief lock requires a passed S1 interview');
	}
	if (project.stage.state === 'PASSED') {
		throw new Error('S2 brief is already locked');
	}
	const current = project.brief_state.versions.at(-1);
	if (!current || project.brief_state.current_version !== current.version) {
		throw new Error('A complete current brief is required');
	}
	if (current.version !== input.briefVersion || current.content_hash !== input.briefHash) {
		throw new Error('Brief lock is stale; reload the current brief before approving');
	}
	const approval: BriefApproval = {
		event: 'brief_locked', brief_id: current.brief_id, brief_version: current.version,
		brief_hash: current.content_hash, operator: input.operator, timestamp: input.now
	};
	return {
		...project,
		stage: { id: 'S2', state: 'PASSED', confidence: project.stage.confidence },
		approval_history: [...project.approval_history, approval]
	};
}
