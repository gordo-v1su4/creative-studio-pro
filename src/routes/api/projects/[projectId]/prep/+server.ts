import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { referenceSpecSchema } from '$lib/domain/prep';
import { setPrepWorkflow, setSheetInputs, setPrepVersionRemoved } from '$lib/server/prep';
import { addReference } from '$lib/server/drift';
import { characterSheetInputsSchema } from '$lib/domain/character-sheet';
import { IMAGE_MODEL_IDS } from '$lib/domain/image-models';
import { episodeSpend } from '$lib/domain/stills';
import { getPrepDeps } from '$lib/server/config';
import { AgentRuleBreakError } from '$lib/server/model-provider';
import {
	addSource, attachOutside, draftSpec, editPrompt, fillIdentity, prepView, quotePrep, removeSource, rerunScaleCheck, saveSpec, sendPrep, setBodySource, setImageModel, settlePrep, useCurrentAsSource, usePrepVersion, writePrompt
} from '$lib/server/prep';

const fail = (status: number, message: string, reasons: string[] = []) => json({ ok: false, error: { code: status === 404 ? 'NOT_FOUND' : status === 422 ? 'GATE_BLOCKED' : 'INVALID_COMMAND', message, reasons, retryable: status >= 500, source: 'prep' } }, { status });
const key = z.string().min(1).max(300);
const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('set_sheet_inputs'), key, inputs: characterSheetInputsSchema }),
	z.object({ action: z.literal('set_workflow'), key, stage: z.enum(['face_lock', 'outfit', 'sheet', 'environment', 'coverage']).optional(), approved_source_url: z.string().max(1000).nullable().optional(), confirm: z.boolean().optional() }),
	z.object({ action: z.literal('add_entry'), kind: z.enum(['character', 'location', 'prop']), name: z.string().trim().min(1).max(200), handle: z.string().trim().max(60).optional(), scene_ids: z.array(z.string().min(1).max(64)).max(50).optional() }),
	z.object({ action: z.literal('use_version'), key, version_id: z.string().min(1).max(300) }),
	z.object({ action: z.literal('set_version_removed'), key, version_id: z.string().min(1).max(300), removed: z.boolean() }),
	z.object({ action: z.literal('set_image_model'), key, model: z.enum(IMAGE_MODEL_IDS) }),
	z.object({ action: z.literal('set_body_source'), key, url: z.string().min(1).max(1000).nullable() }),
	z.object({ action: z.literal('add_prop'), name: z.string().trim().min(1).max(200), handle: z.string().trim().max(60).optional(), scene_ids: z.array(z.string().min(1).max(64)).max(50).optional() }),
	z.object({ action: z.literal('use_current'), key }),
	z.object({ action: z.literal('remove_source'), key, url: z.string().min(1).max(1000) }),
	z.object({ action: z.literal('draft_spec'), key }),
	z.object({ action: z.literal('fill_identity'), key }),
	z.object({ action: z.literal('save_spec'), key, spec: referenceSpecSchema, approve: z.boolean() }),
	z.object({ action: z.literal('write_prompt'), key }),
	z.object({ action: z.literal('edit_prompt'), key, prompt: z.string().min(1).max(20_000) }),
	z.object({ action: z.literal('quote'), key }),
	z.object({ action: z.literal('send'), key, approval_key: z.string().min(1).max(64), confirmed_credits: z.number().nonnegative() }),
	z.object({ action: z.literal('settle'), key }),
	z.object({ action: z.literal('scale_check'), key, source_url: z.string().min(1).max(1000).optional() })
]);

/** Prep (V1S-374): GET the list; POST json actions; POST multipart (action=source|attach, key, file) for images. */
export const GET: RequestHandler = async ({ params }) => {
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(idSchema.parse(params.projectId));
	if (!project) return fail(404, 'Project not found');
	const view = await prepView(deps, project);
	return view.ok ? json({ ok: true, data: { items: view.items, props: view.props, reference_project: view.reference_project, episode_spent: episodeSpend(project.production) } }) : fail(view.status, view.message);
};

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return fail(400, 'Invalid project id');
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return fail(404, 'Project not found');
	const done = async (result: { ok: true } | { ok: false; status: number; message: string; reasons?: string[] }, extra: Record<string, unknown> = {}) => {
		if (!result.ok) return fail(result.status, result.message, result.reasons);
		const fresh = (await deps.store.readProject(projectId.data)) ?? project;
		const view = await prepView(deps, fresh);
		return json({ ok: true, ...extra, data: view.ok ? { items: view.items, props: view.props, reference_project: view.reference_project, episode_spent: episodeSpend(fresh.production) } : null, project: fresh });
	};
	try {
		if ((request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
			const form = await request.formData();
			const action = form.get('action'), entry = form.get('key'), file = form.get('file');
			if (typeof entry !== 'string' || !(file instanceof File)) return fail(400, 'Send key and the image file');
			const input = { file_name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
			if (action === 'source') return done(await addSource(deps, projectId.data, entry, input));
			if (action === 'attach') return done(await attachOutside(deps, project, entry, input));
			return fail(400, 'Unknown upload action');
		}
		const body = bodySchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return fail(400, body.error.issues[0]?.message ?? 'Invalid Prep request');
		const b = body.data;
		switch (b.action) {
			case 'set_workflow': return done(await setPrepWorkflow(deps, project, b.key, b));
			case 'set_sheet_inputs': return done(await setSheetInputs(deps, project, b.key, b.inputs));
			// Drift 02 (ADR 0012): the Notion References page first, then the Prep entry; a refusal adds nothing.
			case 'add_entry': return done(await addReference(deps, project, b));
			case 'use_version': return done(await usePrepVersion(deps, project, b.key, b.version_id));
			case 'set_version_removed': return done(await setPrepVersionRemoved(deps, project, b.key, b.version_id, b.removed));
			case 'set_image_model': return done(await setImageModel(deps, project, b.key, b.model));
			case 'set_body_source': return done(await setBodySource(deps, projectId.data, b.key, b.url));
			case 'add_prop': return done(await addReference(deps, project, { ...b, kind: 'prop' }));
			case 'use_current': return done(await useCurrentAsSource(deps, project, b.key));
			case 'remove_source': return done(await removeSource(deps, projectId.data, b.key, b.url));
			case 'draft_spec': return done(await draftSpec(deps, project, b.key));
			case 'fill_identity': return done(await fillIdentity(deps, project, b.key));
			case 'save_spec': return done(await saveSpec(deps, project, b.key, { spec: b.spec, approve: b.approve }));
			case 'write_prompt': return done(await writePrompt(deps, project, b.key));
			case 'edit_prompt': await editPrompt(deps, projectId.data, b.key, b.prompt); return done({ ok: true });
			case 'quote': { const quoted = await quotePrep(deps, project, b.key); return quoted.ok ? done({ ok: true }, { approval: quoted.approval }) : done(quoted); }
			case 'send': { const sent = await sendPrep(deps, project, b.key, { approval_key: b.approval_key, confirmed_credits: b.confirmed_credits }); return sent.ok ? done({ ok: true }, { job_id: sent.job_id }) : done(sent); }
			case 'scale_check': return done(await rerunScaleCheck(deps, project, b.key, b.source_url));
			case 'settle': { const settled = await settlePrep(deps, project, b.key); return settled.ok ? done({ ok: true }, { pending: settled.pending }) : done(settled); }
		}
	} catch (cause) {
		if (cause instanceof AgentRuleBreakError) return fail(422, cause.message);
		return fail(502, cause instanceof Error ? cause.message : 'Prep failed');
	}
};
