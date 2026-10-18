import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertToModelMessages, stepCountIs, streamText, tool, type ToolSet, type UIMessage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { idSchema } from '$lib/domain/schemas';
import { getNotionToken, getProjectStore, getSeriesStore, resolveProjectModel } from '$lib/server/config';
import { SAVE_THE_CAT, TV_EPISODE } from '$lib/domain/structures';
import { createNotionApi } from '$lib/server/notion';
import { createStoryWriter, notionUrl } from '$lib/server/story-writer';

/**
 * The Agent's free chat (V1S-282) on the Vercel AI SDK: streamed replies through the project's model provider
 * (Hyper, custom endpoint, Kimi, Raycast bridge — any OpenAI-compatible connection), with the story-interview
 * skill as its brief. With a connected series it reads the series and (V1S-324) writes story beats, episode
 * outlines and this episode's scenes (Action, Dialogue, links) into Notion through checked tools that never
 * touch codes. Without a Notion connection it hands back the same structure as Markdown.
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
	const record = seriesId ? await getSeriesStore().read(seriesId) : null;
	const token = getNotionToken();
	const writer = record && token ? createStoryWriter({ api: createNotionApi(token), record, episodePageId: project.series?.episode_page_id ?? null }) : null;

	const tools: ToolSet = {};
	if (record) {
		tools.read_series = tool({
			description: 'Read the connected Notion series: the season story, its story beats by section (with page ids), every episode (page id, summary, outline), this episode\'s scenes (Action, Dialogue, linked story beats and references) and the References (exact names, @handles, kinds, page ids).',
			inputSchema: z.object({}),
			execute: async () => {
				const fresh = (await getSeriesStore().read(record.series_id)) ?? record;
				return {
					title: fresh.title,
					story: fresh.story?.text.slice(0, 12_000) ?? '',
					story_beats: (fresh.story_beats?.beats ?? []).map((beat) => ({ page_id: beat.page_id, section: beat.section, order: beat.order, title: beat.title, summary: beat.summary, episode_page_ids: beat.episode_ids, scene_page_ids: beat.scene_ids })),
					episodes: fresh.episodes.map((episode) => ({ page_id: episode.page_id, number: episode.number, title: episode.title, summary: episode.summary, outline: episode.outline ?? '', twist: episode.twist, cliffhanger: episode.cliffhanger, scenes: episode.scene_count, this_project: episode.page_id === project.series?.episode_page_id })),
					this_episode_scenes: (project.series?.scenes ?? []).map((scene) => ({ page_id: scene.page_id, number: scene.number, title: scene.title, section: scene.act, summary: scene.summary, action: scene.story_beats, dialogue: scene.dialogue ?? '', location: scene.location, characters: scene.characters, story_beat_page_ids: scene.story_beat_ids ?? [], reference_page_ids: scene.reference_ids ?? [] })),
					references: (fresh.references?.items ?? []).map((ref) => ({ page_id: ref.page_id, name: ref.name, kind: ref.kind, role: ref.role, handles: ref.handles }))
				};
			}
		});
	}
	if (writer) {
		tools.write_story_beat = tool({
			description: 'Create a season story beat (omit page_id) or update one (page_id). One Save the Cat section; a one-sentence summary where one thing clearly happens.',
			inputSchema: z.object({
				page_id: z.string().optional(), title: z.string().min(1).max(200), section: z.enum(SAVE_THE_CAT.sections as [string, ...string[]]),
				order: z.number().int().optional(), summary: z.string().max(4000), episode_page_id: z.string().optional()
			}),
			execute: async (input) => writer.writeStoryBeat(input)
		});
		tools.write_episode_outline = tool({
			description: 'Write an episode\'s outline (its main story points in order, section-tagged, flashbacks marked) and optionally its summary, mid-episode twist and cliffhanger.',
			inputSchema: z.object({ episode_page_id: z.string(), outline: z.string().min(1).max(20_000), summary: z.string().max(4000).optional(), twist: z.string().max(4000).optional(), cliffhanger: z.string().max(4000).optional() }),
			execute: async (input) => writer.writeEpisodeOutline(input)
		});
		tools.write_scene = tool({
			description: 'Create (omit page_id) or update a scene of THIS project\'s episode: name-only title, Scene # in tens, section, summary, Action (what happens, in order), Dialogue (one line each: SPEAKER (delivery): "line"), and links to its story beats and references by page id. Never codes.',
			inputSchema: z.object({
				page_id: z.string().optional(), episode_page_id: z.string(), title: z.string().min(1).max(200), number: z.number().int(),
				section: z.enum(TV_EPISODE.sections as [string, ...string[]]), summary: z.string().max(4000), action: z.string().max(20_000), dialogue: z.string().max(20_000),
				location: z.string().max(400).optional(), characters: z.array(z.string().max(100)).max(40).optional(),
				story_beat_page_ids: z.array(z.string()).max(40).optional(), reference_page_ids: z.array(z.string()).max(40).optional()
			}),
			execute: async (input) => writer.writeScene(input)
		});
	}

	const result = streamText({
		model: provider(resolved.connection.choice.model),
		system: [
			'You are the Agent in Creative Studio Pro, running the story-interview skill below. Keep it short: at most three rounds of questions, and decide anything with a sensible default.',
			`Save the Cat sections: ${SAVE_THE_CAT.sections.join(', ')}. TV episode sections: ${TV_EPISODE.sections.join(', ')}.`,
			writer
				? `You can write to Notion with write_story_beat, write_episode_outline and write_scene (only this project's episode gets scenes). Call read_series first. Write only after the user agrees to the structure; then write everything, and end with a short summary listing each page you created or updated with its link. Series page: ${notionUrl(record!.notion_root_id)}.`
				: 'You cannot write to Notion from here (no Notion connection); finish with the filled structure as Markdown (season story beats by section, episode outlines, then this episode\'s scenes with Action and Dialogue) for the writer to put into the Notion template.',
			record ? 'This project is an episode of a connected series: call read_series before suggesting changes to it.' : 'This project is not connected to a series; work from what the user tells you.',
			skill
		].join('\n\n'),
		messages: await convertToModelMessages(body.messages),
		stopWhen: stepCountIs(writer ? 60 : 4),
		tools: Object.keys(tools).length ? tools : undefined
	});
	return result.toUIMessageStreamResponse();
};
