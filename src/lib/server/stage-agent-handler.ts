import { z } from 'zod';
import type { ProjectStore } from '$lib/adapters/project-store';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import type { Project } from '$lib/domain/schemas';
import type { StageAgent } from '$lib/server/stage-agent';
import { fallbackQuestion } from '$lib/server/stage-agent';
import { commandStatus } from '$lib/server/http';
import { isCurrentBriefLocked } from '$lib/domain/gates';

export const stageAgentRequestSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('start') }),
	z.object({
		mode: z.literal('answer'),
		expected_version: z.number().int().nonnegative(),
		question: z.string().trim().min(1).max(1000),
		answer: z.string().trim().min(1).max(10_000)
	})
]);

type Dependencies = {
	store: Pick<ProjectStore, 'readProject'>;
	gateway: Pick<ProjectCommandGateway, 'recordInterviewRound'>;
	agent: StageAgent | null;
};

export type StageAgentHttpResult = { status: number; body: Record<string, unknown> };

function error(status: number, code: string, message: string, retryable: boolean, source: string): StageAgentHttpResult {
	return { status, body: { ok: false, error: { code, message, retryable, source } } };
}

function completeState(project: Project): StageAgentHttpResult | null {
	if (project.interview.status === 'PASSED') {
		const confirmed = project.stage.id === 'S2' && project.stage.state === 'PASSED' && isCurrentBriefLocked(project);
		return { status: 200, body: { ok: true, data: { project, message: confirmed
			? 'S1 is passed and the locked brief is confirmed at S2. Next, build the story spine.'
			: 'S1 is passed. This historical project still needs its current brief locked to confirm S2.', next_question: null } } };
	}
	if (project.interview.status === 'STALLED') {
		return { status: 200, body: { ok: true, data: { project, message: 'S1 is stalled after three low-confidence rounds. Review the recorded blockers before continuing.', next_question: null } } };
	}
	if (project.stage.id !== 'S0' && project.stage.id !== 'S1') {
		return error(409, 'ILLEGAL_STAGE', `Stage Agent interviews are unavailable at ${project.stage.id}`, false, 'stage-agent');
	}
	return null;
}

export async function handleStageAgent(projectId: string, raw: unknown, dependencies: Dependencies): Promise<StageAgentHttpResult> {
	const parsed = stageAgentRequestSchema.safeParse(raw);
	if (!parsed.success) return error(400, 'INVALID_COMMAND', parsed.error.issues[0]?.message ?? 'Invalid Stage Agent request', false, 'stage-agent');

	let project: Project | null;
	try { project = await dependencies.store.readProject(projectId); }
	catch (cause) { return error(500, 'STORE_ERROR', cause instanceof Error ? cause.message : 'Project read failed', true, 'project-store'); }
	if (!project) return error(404, 'NOT_FOUND', `Project ${projectId} not found`, false, 'project-store');

	const completed = completeState(project);
	if (completed) return completed;
	if (!isCurrentBriefLocked(project)) {
		return error(409, 'BRIEF_NOT_LOCKED', 'Save and lock the current brief before starting the Stage Agent interview.', false, 'stage-agent');
	}
	if (!dependencies.agent) return error(503, 'NOT_CONFIGURED', 'KIMI_API_KEY is not configured for the Stage Agent', true, 'kimi');

	if (parsed.data.mode === 'answer' && project.version !== parsed.data.expected_version) {
		return error(409, 'VERSION_CONFLICT', `Version conflict: expected ${parsed.data.expected_version}, current ${project.version}`, true, 'project-store');
	}

	try {
		if (parsed.data.mode === 'start') {
			const turn = await dependencies.agent.start(project);
			return { status: 200, body: { ok: true, data: { project, ...turn, provider: dependencies.agent.provider, model: dependencies.agent.model } } };
		}

		const evaluation = await dependencies.agent.evaluate(project, parsed.data.question, parsed.data.answer);
		const outcome = await dependencies.gateway.recordInterviewRound({
			command: 'record_interview_round',
			project_id: projectId,
			expected_version: parsed.data.expected_version,
			questions: [{ prompt: parsed.data.question, answer: parsed.data.answer }],
			scores: evaluation.scores,
			overall: evaluation.overall,
			resolutions: evaluation.resolutions
		});
		if (!outcome.ok) return { status: commandStatus(outcome.error), body: outcome as unknown as Record<string, unknown> };

		const latest = outcome.data.interview.rounds.at(-1);
		if (!latest) return error(500, 'STORE_ERROR', 'Interview round was not persisted', true, 'project-store');
		const passed = latest.status === 'PASSED';
		const stalled = latest.status === 'STALLED';
		const nextQuestion = passed || stalled
			? null
			: evaluation.next_question ?? fallbackQuestion(latest.lowest_dimension, latest.scores.find((score) => score.dimension === latest.lowest_dimension)?.notes ?? '');
		const suffix = passed
			? `\n\nS1 is passed at ${latest.overall}/100. The locked brief is confirmed at S2; next, build the story spine.`
			: stalled
				? '\n\nS1 is stalled. Review the recorded blockers before another round.'
				: '';
		return {
			status: 200,
			body: {
				ok: true,
				data: {
					project: outcome.data,
					message: `${evaluation.message}${suffix}`,
					next_question: nextQuestion,
					provider: dependencies.agent.provider,
					model: dependencies.agent.model
				}
			}
		};
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'Kimi Stage Agent request failed';
		return error(502, 'STAGE_AGENT_ERROR', message, true, 'kimi');
	}
}
