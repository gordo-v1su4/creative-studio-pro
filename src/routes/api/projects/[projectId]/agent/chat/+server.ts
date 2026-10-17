import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getProjectStore, getSeriesStore, resolveProjectModel } from '$lib/server/config';
import { SAVE_THE_CAT, TV_EPISODE } from '$lib/domain/structures';

/**
 * The Agent's free chat (V1S-282) on the Vercel AI SDK: streamed replies through the project's model provider
 * (Hyper, custom endpoint, Kimi, Raycast bridge — any OpenAI-compatible connection), with the story-interview
 * skill as its brief and a tool that reads the connected Notion series. It never writes to Notion (the
 * connection is read-only); its result is the filled structure for the writer to put in the template.
 */
const SKILL = join(process.cwd(), '.agents', 'skills', 'story-interview', 'SKILL.md');

export const POST: RequestHandler = async ({ params, request }) => {
	const projectId = idSchema.safeParse(params.projectId);
	if (!projectId.success) return json({ ok: false, error: { message: 'Invalid project id' } }, { status: 400 });
	const project = await getProjectStore().readProject(projectId.data);
	if (!project) return json({ ok: false, error: { message: 'Project not found' } }, { status: 404 });
	const resolved = await resolveProjectModel(project);
	if (!resolved.ok) return json({ ok: false, error: { message: `No Agent model: ${resolved.message}` } }, { status: 503 });
	const body = (await request.json().catch(() => null)) as { messages?: UIMessage[] } | null;
	if (!Array.isArray(body?.messages)) return json({ ok: false, error: { message: 'Send the chat messages' } }, { status: 400 });

	const skill = await readFile(SKILL, 'utf8').catch(() => '');
	const provider = createOpenAICompatible({ name: resolved.connection.choice.provider, apiKey: resolved.connection.apiKey, baseURL: resolved.connection.baseURL });
	const seriesId = project.series?.series_id ?? null;
	const result = streamText({
		model: provider(resolved.connection.choice.model),
		system: [
			'You are the Agent in Creative Studio Pro, running the story-interview skill below. Keep it short: at most three rounds of questions, and decide anything with a sensible default.',
			`Save the Cat sections: ${SAVE_THE_CAT.sections.join(', ')}. TV episode sections: ${TV_EPISODE.sections.join(', ')}.`,
			'You cannot write to Notion from here; finish with the filled structure as Markdown (season story beats by section, then each episode with its scenes) for the writer to put into the Notion template.',
			seriesId ? 'This project is an episode of a connected series: call read_series before suggesting changes to it.' : 'This project is not connected to a series; work from what the user tells you.',
			skill
		].join('\n\n'),
		messages: await convertToModelMessages(body.messages),
		stopWhen: stepCountIs(4),
		tools: seriesId ? {
			read_series: tool({
				description: 'Read the connected Notion series: the season story text, its story beats by section, and the episode list with summaries.',
				inputSchema: z.object({}),
				execute: async () => {
					const record = await getSeriesStore().read(seriesId);
					if (!record) return { error: 'The series is not connected' };
					return {
						title: record.title,
						story: record.story?.text.slice(0, 12_000) ?? '',
						story_beats: (record.story_beats?.beats ?? []).map((beat) => ({ section: beat.section, title: beat.title, summary: beat.summary })),
						episodes: record.episodes.map((episode) => ({ number: episode.number, title: episode.title, summary: episode.summary, twist: episode.twist, cliffhanger: episode.cliffhanger, scenes: episode.scene_count }))
					};
				}
			})
		} : undefined
	});
	return result.toUIMessageStreamResponse();
};
