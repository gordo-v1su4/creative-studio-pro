<script lang="ts">
	/**
	 * "Queue re-render" in the review block (decisions 28 to 32): on a take marked Needs changes, one box for what
	 * to change, then the entry itself: Drafting while the Agent writes the prompt change, then To approve with what
	 * was added and taken out highlighted, an editor per section, and where and at what size it is made. Approve is
	 * the only way forward, and it spends nothing: price and Confirm are in the Queue.
	 */
	import { changeCount, promptChange } from '$lib/domain/prompt-change';
	import { ghostSections, withGhostSection } from '$lib/domain/prompt-sections';
	import { renderState, renderStateLabel, type Render } from '$lib/domain/render-queue';
	import type { RenderProviderId } from '$lib/domain/schemas';
	import PromptSections from './PromptSections.svelte';

	interface ProviderInfo { id: RenderProviderId; label: string; models: Array<{ id: string; label: string; kind: 'video' | 'still'; wired: boolean }>; resolutions: string[]; setup: { ready: true } | { ready: false; reason: string } }

	let { render, blocked = null, providers = [], busy = false, onqueue, onask, onedit, onsettings, onapprove, onremove }: {
		/** The open re-render that answers the take on screen, if there is one. */
		render: Render | null;
		/** Why this take cannot be re-rendered, when it cannot. */
		blocked?: string | null;
		providers?: ProviderInfo[];
		busy?: boolean;
		onqueue: (input: { requested_change?: string; unchanged?: boolean }) => void;
		/** Ask the Agent (again), with other words when given. */
		onask: (requestedChange?: string) => void;
		onedit: (prompt: string) => void;
		onsettings: (settings: { provider?: RenderProviderId; model?: string; resolution?: string }) => void;
		onapprove: () => void;
		onremove: () => void;
	} = $props();

	let asking = $state(false);
	let words = $state('');
	const stage = $derived(render ? renderState(render) : null);
	const before = $derived(render?.prompt_before ?? render?.prompt ?? '');

	/** The operator's edit, kept here until it is saved; it belongs to one entry and one saved prompt. */
	let typed = $state<{ of: string; prompt: string } | null>(null);
	const stamp = $derived(render ? `${render.request_id}:${render.prompt}` : '');
	const prompt = $derived(typed?.of === stamp ? typed.prompt : (render?.prompt ?? ''));
	const unsaved = $derived(!!render && prompt !== render.prompt);
	const parts = $derived(promptChange(before, prompt));
	const count = $derived(changeCount(parts));
	const sections = $derived(ghostSections(prompt));
	const provider = $derived(providers.find((entry) => entry.id === render?.provider) ?? null);
	const check = $derived(!render || unsaved ? null : !render.check ? null : render.check.length ? { label: `${render.check.length} to fix`, tone: 'fix' as const, lines: render.check } : { label: 'Check clean', tone: 'clean' as const });

	function open(prefill = '') { words = prefill; asking = true; }
	function send() {
		const text = words.trim();
		if (!text) return;
		asking = false;
		if (render) onask(text); else onqueue({ requested_change: text });
	}
</script>

<div class="rr">
	<p class="cp head"><span class="title">Re-render</span>{#if stage}<span class="state" data-state={stage}>{renderStateLabel(stage)}</span>{/if}{#if render && (stage === 'to_approve' || stage === 'approved')}<span class="count">+{count.added} −{count.removed}</span>{/if}</p>

	{#if blocked && !render}
		<p class="hint">{blocked}</p>
	{:else if asking}
		<textarea rows="3" bind:value={words} placeholder="What do you want to change?" aria-label="What do you want to change?"></textarea>
		<div class="row">
			<button type="button" class="key go" disabled={busy || !words.trim()} onclick={send}>{render ? 'Ask again' : 'Queue'}</button>
			{#if !render}<button type="button" class="key" disabled={busy} onclick={() => { asking = false; onqueue({ unchanged: true }); }}>Render again unchanged</button>{/if}
			<button type="button" class="key" onclick={() => (asking = false)}>Cancel</button>
		</div>
	{:else if !render}
		<div class="row"><button type="button" class="key go" disabled={busy} onclick={() => open()}>Queue re-render</button></div>
	{:else if stage === 'drafting'}
		{#if render.requested_change}<p class="asked">{render.requested_change}</p>{/if}
		{#if render.error}
			<p class="hint bad">{render.error}</p>
			<div class="row">
				<button type="button" class="key go" disabled={busy} onclick={() => onask()}>Ask again</button>
				<button type="button" class="key" disabled={busy} onclick={() => open(render.requested_change ?? '')}>Change the request</button>
				<button type="button" class="key" disabled={busy} onclick={onremove}>Remove</button>
			</div>
		{:else}
			<p class="hint">The Agent is writing the prompt change…</p>
		{/if}
	{:else if stage === 'to_approve' || stage === 'approved'}
		{#if render.requested_change}<p class="asked">{render.requested_change}</p>{:else if render.unchanged}<p class="asked">Unchanged: the earlier prompt, sent again</p>{/if}
		{#if render.notes?.length}<p class="hint">Answers {render.notes.length} note{render.notes.length === 1 ? '' : 's'} from Review Room</p>{/if}
		<p class="change" aria-label="The prompt change">{#each parts as part, i (i)}{#if part.kind === 'added'}<ins>{part.text}</ins>{:else if part.kind === 'removed'}<del>{part.text}</del>{:else}{part.text}{/if}{/each}</p>
		{#if sections}
			<PromptSections title="Prompt" skill="Ghost" sections={sections} scope={render.request_id} {check} onedit={(key, text) => (typed = { of: stamp, prompt: withGhostSection(prompt, key, text) })} />
		{:else}
			<p class="cp head"><span class="title">Prompt</span>{#if check}<span class="count" data-tone={check.tone}>{check.label}</span>{/if}</p>
			<textarea rows="6" value={prompt} aria-label="The prompt as it will be sent" oninput={(event) => (typed = { of: stamp, prompt: event.currentTarget.value })}></textarea>
			{#if check?.lines?.length}<ul class="found">{#each check.lines as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
		{/if}
		{#if unsaved}
			<div class="row">
				<button type="button" class="key go" disabled={busy || !prompt.trim()} onclick={() => onedit(prompt)}>Save edit</button>
				<button type="button" class="key" onclick={() => (typed = null)}>Discard</button>
			</div>
		{/if}
		<div class="where">
			<select aria-label="Render provider" value={render.provider} disabled={busy} onchange={(event) => onsettings({ provider: event.currentTarget.value as RenderProviderId })}>
				{#each providers as entry (entry.id)}<option value={entry.id} disabled={!entry.setup.ready} title={entry.setup.ready ? '' : entry.setup.reason}>{entry.label}{entry.setup.ready ? '' : ' (not set up)'}</option>{/each}
				{#if !providers.length}<option value={render.provider}>{render.provider}</option>{/if}
			</select>
			<select aria-label="Model" value={render.model} disabled={busy} onchange={(event) => onsettings({ model: event.currentTarget.value })}>
				{#each (provider?.models ?? []).filter((model) => model.kind === 'video' && model.wired) as model (model.id)}<option value={model.id}>{model.label}</option>{/each}
				{#if !provider?.models.some((model) => model.id === render.model)}<option value={render.model}>{render.model}</option>{/if}
			</select>
			<select aria-label="Resolution" value={render.resolution} disabled={busy} onchange={(event) => onsettings({ resolution: event.currentTarget.value })}>
				{#each provider?.resolutions ?? [render.resolution] as size (size)}<option value={size}>{size}</option>{/each}
			</select>
		</div>
		<div class="row">
			{#if stage === 'to_approve'}
				<button type="button" class="key go" disabled={busy || unsaved} title={unsaved ? 'Save or discard your edit first' : 'Approve this prompt change. Nothing is spent until Confirm in the Queue.'} onclick={onapprove}>Approve</button>
			{/if}
			<button type="button" class="key" disabled={busy} onclick={() => open(render.requested_change ?? '')}>Ask again</button>
			<button type="button" class="key" disabled={busy} onclick={onremove}>Remove</button>
		</div>
		{#if stage === 'approved'}<p class="hint">Approved. It is priced and confirmed with the others in the Queue; nothing is spent before that.</p>{/if}
	{:else}
		<p class="hint">{stage === 'failed' || stage === 'refused' ? (render.error ?? 'It did not render.') : 'Sent. A finished re-render is added as another take, awaiting review.'}</p>
	{/if}
</div>

<style>
	.rr { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
	.head { display: flex; align-items: baseline; gap: 10px; margin: 0; overflow: hidden; color: var(--color-ink-3); white-space: nowrap; }
	.title { color: var(--color-ink-2); }
	.state { color: var(--color-amber); }
	.state[data-state='approved'] { color: var(--color-teal); }
	.state[data-state='failed'], .state[data-state='refused'] { color: #ff7a6b; }
	.count { margin-left: auto; color: var(--color-ink-3); font: 10.5px var(--font-mono); }
	.count[data-tone='clean'] { color: var(--color-teal); }
	.count[data-tone='fix'] { color: #ff7a6b; }
	.hint { margin: 0; color: var(--color-ink-3); font-size: 12px; line-height: 1.5; }
	.hint.bad { color: #ff7a6b; }
	.asked { margin: 0; color: var(--color-ink); font-size: 12.5px; line-height: 1.45; }
	.row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
	.change { max-height: 168px; margin: 2px 0 0; overflow-y: auto; border-radius: 6px; background: var(--color-raised); padding: 6px 8px; color: var(--color-ink-2); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
	.change ins { border-radius: 2px; background: var(--color-teal-deep); color: var(--color-teal-ink); text-decoration: none; }
	.change del { color: var(--color-ink-3); text-decoration: line-through; }
	textarea { resize: vertical; border: 0; border-radius: 6px; background: var(--color-raised); padding: 6px 8px; color: var(--color-ink); font: 12px/1.5 var(--font-sans); }
	textarea:focus-visible, select:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -1px; }
	.where { display: flex; gap: 4px; margin-top: 4px; }
	select { height: 24px; min-width: 0; flex: 1; border: 0; border-radius: 5px; background: var(--color-control); padding: 0 6px; color: var(--color-ink); font: 12px var(--font-sans); }
	.found { margin: 2px 0 0; padding: 0 0 0 16px; color: #ff7a6b; font-size: 12px; line-height: 1.5; }
</style>
