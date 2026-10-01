import { z } from 'zod';
import type { ProjectCommandGateway } from '$lib/application/gateway';
import { modelProviderKindSchema } from '$lib/domain/model-provider';
import type { ModelChoice, ProjectModelView } from '$lib/domain/model-provider';
import type { Project } from '$lib/domain/schemas';
import { commandStatus } from '$lib/server/http';
import type { ModelResolution } from '$lib/server/model-provider';
import { prepareVisionChoice } from '$lib/server/model-settings';
import type { ModelSettingsDeps } from '$lib/server/model-settings';

/**
 * Per-project Agent model (V1S-117): read the effective model, and change the
 * override through the command gateway (append-only, operator-attributed).
 */

export function projectModelView(project: Project, resolution: ModelResolution): ProjectModelView {
	return {
		override: project.agent_model.override,
		locked_at: project.agent_model.locked_at,
		history: project.agent_model.history,
		effective: resolution.ok ? resolution.connection.choice : resolution.choice,
		source: resolution.source,
		available: resolution.ok,
		message: resolution.ok ? null : resolution.message
	};
}

export const projectModelRequestSchema = z.object({
	expected_version: z.number().int().nonnegative(),
	choice: z.object({ provider: modelProviderKindSchema, model: z.string().trim().min(1).max(200) }).nullable(),
	reason: z.string().trim().max(1000).nullable().optional(),
	confirm_switch: z.boolean().optional()
});

export type ProjectModelHttpResult = { status: number; body: Record<string, unknown> };

export async function handleProjectModelChange(
	projectId: string,
	raw: unknown,
	deps: { gateway: Pick<ProjectCommandGateway, 'setProjectModel'>; settings: ModelSettingsDeps; operator: string }
): Promise<ProjectModelHttpResult> {
	const parsed = projectModelRequestSchema.safeParse(raw);
	if (!parsed.success) return { status: 400, body: { ok: false, error: { code: 'INVALID_COMMAND', message: parsed.error.issues[0]?.message ?? 'Invalid model change', retryable: false, source: 'application' } } };
	let choice: ModelChoice | null = null;
	if (parsed.data.choice) {
		const prepared = await prepareVisionChoice(deps.settings, parsed.data.choice.provider, parsed.data.choice.model);
		if (!prepared.ok) return { status: prepared.status, body: { ok: false, error: { ...prepared.error, retryable: false, source: 'model-provider' } } };
		choice = prepared.data;
	}
	const outcome = await deps.gateway.setProjectModel({
		command: 'set_project_model',
		project_id: projectId,
		expected_version: parsed.data.expected_version,
		choice,
		operator: deps.operator,
		reason: parsed.data.reason ?? null,
		confirm_switch: parsed.data.confirm_switch ?? false
	});
	return outcome.ok
		? { status: 200, body: outcome as unknown as Record<string, unknown> }
		: { status: commandStatus(outcome.error), body: outcome as unknown as Record<string, unknown> };
}
