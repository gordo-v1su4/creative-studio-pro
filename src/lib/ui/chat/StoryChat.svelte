<script lang="ts">
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';

	/**
	 * The Agent's Story mode (V1S-282): a streamed chat on the Vercel AI SDK that runs the story-interview
	 * skill (idea → three directions → Save the Cat season and TV-episode acts, at most three rounds), reading
	 * the connected Notion series through a tool whose results show inline.
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
		<textarea bind:value={input} rows="2" placeholder="Your idea, or an answer…" aria-label="Message the Agent" onkeydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }}></textarea>
		{#if busy}
			<button type="button" class="key" onclick={() => void chat.stop()}>Stop</button>
		{:else}
			<button type="submit" class="key accent" disabled={!input.trim()}>Send</button>
		{/if}
	</form>
</div>

<style>
	.story-chat { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 8px; height: 100%; min-height: 0; }
	.log { display: grid; align-content: start; gap: 10px; overflow-y: auto; padding-right: 4px; }
	.hint { color: var(--color-nr-dim); font-size: 12px; line-height: 1.6; }
	.msg { display: grid; gap: 6px; }
	.msg.user .text { justify-self: end; max-width: 85%; border: 1px solid var(--color-nr-line); border-radius: 2px; padding: 6px 9px; color: var(--color-nr-ink); }
	.msg.assistant .text { color: var(--color-nr-text); }
	.text { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; }
	.tool { border: 1px solid var(--color-nr-line-soft); border-radius: 2px; padding: 4px 8px; font-size: 11px; color: var(--color-nr-dim); }
	.tool summary { cursor: pointer; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; font-size: 9.5px; }
	.tool pre { margin-top: 6px; max-height: 220px; overflow: auto; color: var(--color-nr-muted); font: 10.5px/1.5 var(--font-mono); white-space: pre-wrap; }
	.error { color: var(--color-nr-danger-text); font-size: 12px; }
	.composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
	textarea { resize: none; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 6px 9px; color: var(--color-nr-ink); font: 12.5px/1.5 var(--font-sans); outline: none; }
	textarea:focus { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); }
	.key { display: inline-flex; align-items: center; border: 1px solid var(--color-nr-line); border-radius: 2px; background: transparent; padding: 0 10px; color: var(--color-nr-muted); font: 600 9px/26px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; }
	.key.accent { border-color: color-mix(in srgb, var(--color-nr-accent) 45%, transparent); color: var(--color-nr-accent); }
	.key:disabled { opacity: 0.4; }
</style>
