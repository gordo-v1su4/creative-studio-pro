<script lang="ts">
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';

	/**
	 * The Agent's Story mode (V1S-282): a streamed chat on the Vercel AI SDK that runs the story-interview
	 * skill (idea → three directions → Save the Cat season and TV-episode acts, at most three rounds), reading
	 * the connected Notion series through a tool whose results show inline. V1S-324: it can also write story
	 * beats, episode outlines and this episode's scenes into Notion; each write shows inline with its link.
	 */
	let { projectId }: { projectId: string } = $props();
	const chat = $derived(new Chat({ transport: new DefaultChatTransport({ api: `/api/projects/${projectId}/agent/chat` }) }));
	let input = $state('');
	const busy = $derived(chat.status === 'submitted' || chat.status === 'streaming');

	function send() {
		const text = input.trim();
		if (!text || busy) return;
		input = '';
		void chat.sendMessage({ text });
	}
	const toolLabel = (type: string) => type.replace(/^tool-/, '').replaceAll('_', ' ');
	type WriteOutput = { ok: true; action: string; kind: string; title: string; url: string } | { ok: false; error: string };
	const isWrite = (type: string) => type.startsWith('tool-write_');
	const written = (output: unknown) => output as WriteOutput;
</script>

<div class="story-chat">
	<div class="log" aria-live="polite">
		{#if chat.messages.length === 0}
			<p class="hint">Tell me the idea in a sentence or two. I'll offer three directions, fill the season (Save the Cat) and the episode acts, and only ask about real gaps — three rounds at most.</p>
		{/if}
		{#each chat.messages as message (message.id)}
			<div class={['msg', message.role]}>
				{#each message.parts as part, i (i)}
					{#if part.type === 'text'}
						<p class="text">{part.text}</p>
					{:else if isWrite(part.type)}
						{@const toolPart = part as { type: string; state?: string; output?: unknown }}
						{@const out = toolPart.output ? written(toolPart.output) : null}
						<p class={['write', out && !out.ok && 'refused']}>
							{#if !out}
								<span>Writing {toolLabel(toolPart.type).replace(/^write /, '')}…</span>
							{:else if out.ok}
								<span>Notion · {out.action} {out.kind}</span> <a href={out.url} target="_blank" rel="noreferrer">{out.title}</a>
							{:else}
								<span>Notion refused: {out.error}</span>
							{/if}
						</p>
					{:else if part.type.startsWith('tool-')}
						{@const toolPart = part as { type: string; state?: string; output?: unknown }}
						<details class="tool">
							<summary>{toolLabel(toolPart.type)} · {toolPart.state === 'output-available' ? 'read' : toolPart.state === 'output-error' ? 'failed' : 'reading…'}</summary>
							{#if toolPart.output}<pre>{JSON.stringify(toolPart.output, null, 2).slice(0, 4000)}</pre>{/if}
						</details>
					{/if}
				{/each}
			</div>
		{/each}
		{#if chat.error}<p class="error" role="alert">{chat.error.message}</p>{/if}
	</div>
	<form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
		<textarea bind:value={input} rows="1" placeholder="Your idea, or an answer…" aria-label="Message the Agent" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}></textarea>
		{#if busy}
			<button type="button" class="key" onclick={() => void chat.stop()}>Stop</button>
		{:else}
			<button type="submit" class="key accent" disabled={!input.trim()}>Send</button>
		{/if}
	</form>
</div>

<style>
	.story-chat { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 8px; height: 100%; min-height: 0; }
	.log { display: grid; align-content: start; gap: 12px; overflow-y: auto; padding-right: 4px; scrollbar-color: #26262b transparent; }
	.hint { color: var(--color-ink-3); font-size: 12px; line-height: 1.6; }
	.msg { display: grid; gap: 6px; }
	.msg.user .text { justify-self: end; max-width: 85%; border-radius: 9px; background: var(--color-control); padding: 4px 9px; color: var(--color-ink); }
	.msg.assistant .text { color: #c8c8ce; }
	.text { font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; }
	.tool { color: var(--color-ink-3); font-size: 11px; }
	.tool summary { cursor: pointer; font: 9.5px var(--font-mono); letter-spacing: 0.11em; text-transform: uppercase; }
	.tool pre { max-height: 220px; margin-top: 6px; overflow: auto; border-radius: 6px; background: var(--color-raised); padding: 6px 8px; color: var(--color-ink-2); font: 10.5px/1.5 var(--font-mono); white-space: pre-wrap; }
	.write { color: var(--color-ink-2); font-size: 11.5px; }
	.write span { color: var(--color-ink-3); font: 9.5px var(--font-mono); letter-spacing: 0.11em; text-transform: uppercase; }
	.write a { color: var(--color-ink); text-decoration: underline; text-underline-offset: 2px; }
	.write.refused span { color: #ff7a6b; letter-spacing: 0; text-transform: none; }
	.error { color: #ff7a6b; font-size: 12px; }
	.composer { display: flex; align-items: center; gap: 4px; border-radius: 9px; background: #ffffff0d; padding: 4px 4px 4px 10px; }
	textarea { min-width: 0; flex: 1; resize: none; border: 0; background: none; padding: 3px 0; color: var(--color-ink); font: 12.5px/1.5 var(--font-sans); outline: none; caret-color: var(--color-agent-purple); }
	textarea::placeholder { color: var(--color-ink-3); }
	.key.accent { background: var(--color-agent-purple-deep); color: #d8cffc; }
</style>
