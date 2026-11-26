import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getPrepDeps, getReferenceFileDeps } from '$lib/server/config';
import { checkDrift, markOld } from '$lib/server/drift';
import { answerDrift } from '$lib/server/drift-batch';

/**
 * The drift check (Drift 03, GitHub #32 / V1S-510; ADR 0012): GET compares Notion's References, every series
 * project's Prep and Review Room's reference folders, and returns what is out of step. It only reads. Its "add to
 * Notion" is the Prep add (`POST …/prep`, `add_entry`) on the project the item was found in.
 *
 * POST carries out one choice on one item, or answers several at once. One choice: Drift 04 (GitHub #33 /
 * V1S-511) adds "mark as old" on a Review Room sheet. Several (`answers`, Drift 10, GitHub #38 / V1S-514): the first
 * write alone and checked, then the rest one at a time. It streams one JSON object per line: each `line` as a write
 * runs and ends, then `end` with what was done, what failed and what was left untouched.
 */
export const GET: RequestHandler = async ({ params }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	try {
		const checked = await checkDrift({ ...deps, client: getReferenceFileDeps()?.client ?? null }, project);
		return checked.ok ? json({ ok: true, data: checked.report }) : json({ ok: false, error: { message: checked.message } }, { status: checked.status });
	} catch (cause) {
		return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'The drift check failed' } }, { status: 502 });
	}
};

const choiceSchema = z.discriminatedUnion('choice', [
	z.object({ choice: z.literal('mark_old'), asset_id: z.string().min(1).max(64), history_of: z.string().min(1).max(64).nullable().optional() })
]);
const answerSchema = z.object({
	key: z.string().min(1).max(300),
	choice: z.enum(['add_to_notion', 'link', 'mark_old']),
	kind: z.enum(['character', 'location', 'prop']),
	name: z.string().max(200),
	project_id: idSchema,
	former_names: z.array(z.string().trim().min(1).max(200)).max(10).optional()
});
const bodySchema = z.object({ answers: z.array(answerSchema).min(1).max(60) });

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const raw = await request.json().catch(() => null);
	if (raw && typeof raw === 'object' && 'choice' in raw) {
		const choice = choiceSchema.safeParse(raw);
		if (!choice.success) return json({ ok: false, error: { message: choice.error.issues[0]?.message ?? 'Invalid choice' } }, { status: 400 });
		const deps = await getPrepDeps();
		const project = await deps.store.readProject(projectId.data);
		if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
		try {
			const marked = await markOld({ ...deps, client: getReferenceFileDeps()?.client ?? null }, project, choice.data);
			return marked.ok ? json({ ok: true, data: marked }) : json({ ok: false, error: { message: marked.message } }, { status: marked.status });
		} catch (cause) {
			return json({ ok: false, error: { message: cause instanceof Error ? cause.message : 'Marking the sheet old failed' } }, { status: 502 });
		}
	}
	const body = bodySchema.safeParse(raw);
	if (!body.success) return json({ ok: false, error: { message: 'Give the items to answer, each with its choice and name' } }, { status: 400 });
	const deps = await getPrepDeps();
	const project = await deps.store.readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			// What was written so far, so an error thrown part way still says it.
			const done: string[] = [];
			try {
				const result = await answerDrift({ ...deps, client: getReferenceFileDeps()?.client ?? null }, project, body.data.answers, (line) => {
					if (line.state === 'done' && !line.check) done.push(line.key);
					send({ type: 'line', ...line });
				});
				send({ type: 'end', ...result });
			} catch (cause) {
				send({ type: 'end', ok: false, status: 502, message: `Adding stopped: ${cause instanceof Error ? cause.message : 'unknown error'}`, done, untouched: body.data.answers.map((answer) => answer.key).filter((key) => !done.includes(key)) });
			} finally { controller.close(); }
		}
	});
	return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
};
