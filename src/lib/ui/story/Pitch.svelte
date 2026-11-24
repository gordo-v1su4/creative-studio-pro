<script lang="ts">
	/**
	 * The logline pitch (decision 18, stories 4 and 5): three loglines the Agent pitched, "Make this" on each,
	 * three more on request, and a quick teaser of the pick before any character exists. The pitching and the
	 * teaser's writing are the Agent's actions (`agent-work`); pricing and sending the render are the operator's
	 * two separate steps here, because the Agent never confirms a spend (decision 17).
	 */
	import type { Project } from '$lib/domain/schemas';
	import { DEFAULT_TARGET, SEEDANCE_TARGETS, checkTarget } from '$lib/domain/trailer-house';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';

	let { project, onUpdated }: { project: Project; onUpdated: (project: Project) => void } = $props();

	const house = $derived(project.trailer_house);
	const rounds = $derived(house?.rounds ?? []);
	let shownRound = $state<{ project: string; at: number } | null>(null);
	// The newest round shows unless the operator went back to an earlier one.
	const at = $derived(shownRound?.project === project.project_id && shownRound.at < rounds.length ? shownRound.at : rounds.length - 1);
	const round = $derived(rounds[at]);
	const picked = $derived(house?.picked ?? null);
	const pickedPitch = $derived(picked ? rounds[picked.round]?.pitches[picked.index] ?? null : null);
	const blueprint = $derived(house?.blueprint ?? null);
	const working = $derived(agentWork.busy !== null);
	const live = $derived(agentWork.teaser?.projectId === project.project_id ? agentWork.teaser : null);
	let off = $state('');
	let seconds = $state<{ project: string; value: number } | null>(null);
	const target = $derived({ ...(house?.target ?? DEFAULT_TARGET), seconds: seconds?.project === project.project_id ? seconds.value : (house?.target ?? DEFAULT_TARGET).seconds });
	const fits = $derived(checkTarget(target));
	const errorsLeft = $derived(blueprint?.lint?.remaining.filter((issue) => issue.severity === 'error').length ?? 0);
	const letter = (index: number) => 'ABC'[index] ?? String(index + 1);

	async function more() { await agentWork.pitch(project, off); off = ''; shownRound = null; }

	// The render: priced first, then sent only for the price shown. Changing anything it depends on drops the price.
	let quote = $state<{ key: string; credits: number; balance: number | null } | null>(null);
	let busy = $state<'' | 'price' | 'send' | 'board'>('');
	let said = $state<{ text: string; bad?: boolean } | null>(null);
	const quoteKey = $derived(`${project.project_id}:${blueprint?.created_at ?? ''}:${blueprint?.seedance_prompt.length ?? 0}`);
	const priced = $derived(quote?.key === quoteKey ? quote : null);

	async function render(body: Record<string, unknown>): Promise<({ ok: true; data?: Project; credits?: number; balance?: number | null }) | null> {
		try {
			const response = await fetch(`/api/projects/${project.project_id}/trailer-house/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const text = await response.text();
			let result: { ok: true; data?: Project; credits?: number; balance?: number | null } | { ok: false; error: { message: string } };
			try { result = JSON.parse(text); } catch { throw new Error(`The provider could not be reached from this server (HTTP ${response.status}); rendering may not be set up here`); }
			if (!result.ok) throw new Error(result.error.message);
			if (result.data) onUpdated(result.data);
			return result;
		} catch (cause) { said = { text: cause instanceof Error ? cause.message : 'The render request failed', bad: true }; return null; }
	}
	/** Step one: what a draft render of this teaser costs. Nothing is sent and nothing is spent. */
	async function getPrice() {
		if (busy) return;
		busy = 'price'; said = null;
		const asked = quoteKey;
		const result = await render({ action: 'quote', settings: { resolution: '480p', generate_audio: true } });
		if (result && typeof result.credits === 'number') quote = { key: asked, credits: result.credits, balance: result.balance ?? null };
		busy = '';
	}
	/** Step two: send it for exactly the price shown. */
	async function confirm() {
		if (busy || !priced) return;
		busy = 'send'; said = null;
		const credits = priced.credits;
		const sent = await render({ action: 'send', expected_version: project.version, settings: { resolution: '480p', generate_audio: true }, confirmed_credits: credits });
		if (sent) { quote = null; said = { text: `Sent for ${credits} credits; the clip comes back here when it finishes` }; }
		busy = '';
	}
	async function toShots(requestId: string) {
		if (busy) return;
		busy = 'board'; said = null;
		if (await render({ action: 'board', expected_version: project.version, request_id: requestId })) said = { text: 'Added to the shots, in the Teasers group' };
		busy = '';
	}

	// While a render is on its way, look for it every ten seconds; the finished clip comes back into the project.
	const renders = $derived(house?.renders ?? []);
	const pending = $derived(renders.filter((entry) => entry.status === 'queued' || entry.status === 'in_progress').length);
	$effect(() => {
		if (!pending) return;
		const id = project.project_id;
		const timer = setInterval(async () => {
			try {
				const result = (await (await fetch(`/api/projects/${id}/trailer-house/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'poll' }) })).json()) as { ok: true; data: Project } | { ok: false };
				if (result.ok && result.data.version !== project.version) onUpdated(result.data);
			} catch { /* looked for again at the next tick */ }
		}, 10_000);
		return () => clearInterval(timer);
	});
	const renderLine = (status: string) => (status === 'queued' ? 'Waiting to render' : status === 'in_progress' ? 'Rendering' : status === 'completed' ? 'Rendered' : status === 'nsfw' ? 'Refused by the provider' : 'Failed');
</script>

<section class="pitch" aria-label="Logline pitch">
	{#if !rounds.length}
		<div class="invite">
			<span class="cp kicker">No idea yet?</span>
			<span class="d">The Agent pitches three loglines to react to. Pick one and it drafts the brief from it.</span>
			<button type="button" class="key agent" disabled={working} onclick={() => void agentWork.pitch(project)}>{agentWork.busy === 'pitch' ? 'Pitching…' : 'Pitch three loglines'}</button>
		</div>
	{:else}
		<div class="top">
			<span class="cp kicker">Pitch · round {at + 1}</span>
			{#if rounds.length > 1}
				<span class="rounds" role="group" aria-label="Pitch rounds">{#each rounds as entry, i (entry.created_at + i)}<button type="button" class="tg" aria-pressed={i === at} onclick={() => (shownRound = { project: project.project_id, at: i })}>{i + 1}</button>{/each}</span>
			{/if}
			<span class="steps cp"><b>Logline</b><span>→ quick teaser</span><span>→ characters</span><span>→ shot list</span></span>
		</div>
		<div class="lgs">
			{#each round?.pitches ?? [] as entry, i (i)}
				{@const mine = picked?.round === at && picked.index === i}
				<div class="lg" data-on={mine ? '' : undefined}>
					<span class="n">{letter(i)}</span>
					<div class="b"><h2>{entry.logline}</h2><p>{entry.description}</p></div>
					{#if mine}<span class="cp chosen">Picked</span>{:else}<button type="button" class="key" disabled={working} onclick={() => void agentWork.pick(project, at, i)} title="Make this one: it becomes the logline, and the Agent drafts the brief from it">{agentWork.busy === 'pick' ? '…' : 'Make this'}</button>{/if}
				</div>
			{/each}
		</div>
		<form class="more" onsubmit={(event) => { event.preventDefault(); void more(); }}>
			<button type="submit" class="key agent" disabled={working}>{agentWork.busy === 'pitch' ? 'Pitching…' : 'Three more'}</button>
			<label class="sr" for="pitch-off">What is off about these</label>
			<input id="pitch-off" bind:value={off} placeholder="None of these? Say what's off" maxlength="600" disabled={working} />
		</form>

		{#if pickedPitch}
			<div class="qt">
				<span class="cp kicker">Quick teaser</span>
				<span class="t">{blueprint?.title ?? 'Not written yet'} · </span>
				<label class="sr" for="teaser-seconds">Teaser length in seconds</label>
				<input id="teaser-seconds" class="secs" type="number" min={SEEDANCE_TARGETS[target.model].min_s} max={SEEDANCE_TARGETS[target.model].max_s} step="1" value={target.seconds} disabled={working || !!busy} oninput={(event) => { const value = Math.round(Number(event.currentTarget.value)); if (value > 0) seconds = { project: project.project_id, value }; }} /><span class="t">s</span>
				<span class="d" class:bad={!fits.ok || said?.bad} aria-live="polite">{!fits.ok ? fits.message : said?.text ?? live?.status ?? (blueprint ? (errorsLeft ? `The check still finds ${errorsLeft} thing${errorsLeft === 1 ? '' : 's'} in the prompt` : 'One prompt, one draft render. No characters needed yet.') : 'One prompt, one draft render. No characters needed yet.')}</span>
				{#if blueprint && !live}
					<button type="button" class="key" disabled={working || !!busy || !fits.ok} onclick={() => picked && void agentWork.teaserFor(project, picked.round, picked.index, target)} title="Have the Agent write the teaser again">Write again</button>
					<button type="button" class="key" disabled={!!busy || working || errorsLeft > 0} onclick={() => void getPrice()} title={errorsLeft ? 'The prompt has to pass the check first' : 'Ask what a draft render costs; nothing is spent'}>{busy === 'price' ? 'Pricing…' : 'Get price'}</button>
					<span class="price" class:has={!!priced}>{priced ? `${priced.credits} credits` : 'No price yet'}</span>
					<button type="button" class="key go" disabled={!priced || !!busy || working || (priced.balance !== null && priced.balance < priced.credits)} onclick={() => void confirm()} title={priced ? (priced.balance !== null && priced.balance < priced.credits ? `Only ${priced.balance} credits left` : 'Send the teaser to render for the price shown') : 'Get a price first'}>{busy === 'send' ? 'Sending…' : 'Confirm'}</button>
				{:else}
					<button type="button" class="key agent" disabled={working || !fits.ok} onclick={() => picked && void agentWork.teaserFor(project, picked.round, picked.index, target)} title="The Agent writes one teaser prompt for the pick and checks it. Nothing is rendered.">{live ? 'Writing…' : 'Write teaser'}</button>
				{/if}
			</div>
			{#if blueprint && !live}
				<details class="prompt">
					<summary class="cp">The teaser prompt · {blueprint.logline}</summary>
					<pre>{blueprint.seedance_prompt}</pre>
				</details>
			{/if}
			{#each renders.toReversed() as entry (entry.request_id)}
				<div class="rd">
					<span class="cp" data-state={entry.status}>{renderLine(entry.status)}</span>
					<span class="d">{entry.duration_s}s · {entry.resolution}{entry.draft ? ' draft' : ''} · {entry.estimate_credits} credits{entry.error ? ` · ${entry.error}` : ''}</span>
					{#if entry.video}
						<a class="cp" href={entry.video.url} target="_blank" rel="noopener">Play</a>
						{#if entry.card_id}<span class="cp chosen">In the shots</span>{:else}<button type="button" class="key" disabled={!!busy} onclick={() => void toShots(entry.request_id)} title="Put the clip on the board as a take, in the Teasers group">Add to shots</button>{/if}
					{/if}
				</div>
			{/each}
		{/if}
	{/if}
</section>

<style>
	.pitch { display: flex; max-width: 760px; flex-direction: column; gap: 6px; color: var(--color-ink-2); font: 12.5px/1.35 var(--font-sans); }
	.kicker { color: var(--color-teal); }
	.invite, .qt, .rd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; border-radius: 10px; background: var(--color-raised); padding: 8px 12px; }
	.invite .d, .qt .d, .rd .d { min-width: 160px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-3); }
	.qt .d.bad { color: #ff7a6b; }
	.top { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 0 2px; }
	.rounds { display: flex; gap: 1px; }
	.steps { display: flex; gap: 8px; margin-left: auto; overflow: hidden; color: var(--color-ink-3); }
	.steps b { color: var(--color-teal); font-weight: 400; }
	.lgs { display: flex; flex-direction: column; gap: 3px; }
	.lg { display: flex; align-items: center; gap: 14px; border-radius: 10px; background: #101012; padding: 10px 14px; }
	.lg[data-on] { background: var(--color-selected); }
	.lg .n { width: 10px; flex: none; color: var(--color-ink-3); font: 10.5px var(--font-mono); }
	.lg .b { min-width: 0; flex: 1; }
	.lg h2 { margin: 0 0 3px; color: var(--color-ink); font: 400 14px/1.3 var(--font-sans); }
	.lg[data-on] h2 { color: var(--color-teal-ink); }
	.lg p { margin: 0; color: var(--color-ink-2); line-height: 1.45; }
	.chosen { flex: none; color: var(--color-teal); }
	.more { display: flex; align-items: center; gap: 8px; }
	.more input { height: 24px; min-width: 0; flex: 1; box-sizing: border-box; border: 0; border-radius: 5px; background: var(--color-raised); padding: 0 8px; color: var(--color-ink); font: 12.5px var(--font-sans); outline: none; }
	.more input:focus { background: var(--color-control); }
	.more input::placeholder { color: var(--color-ink-3); }
	.qt { margin-top: 4px; gap: 6px 6px; }
	.qt .kicker { margin-right: 6px; }
	.qt .t { flex: none; color: var(--color-ink); white-space: nowrap; }
	.secs { width: 40px; height: 20px; box-sizing: border-box; flex: none; border: 0; border-radius: 5px; background: var(--color-control); padding: 0 4px; color: var(--color-ink); font: 11px var(--font-mono); outline: none; }
	.qt .d { margin-left: 6px; }
	.price { flex: none; padding: 0 4px; color: var(--color-ink-3); font: 11px var(--font-mono); white-space: nowrap; }
	.price.has { color: var(--color-amber); }
	.prompt summary { cursor: pointer; overflow: hidden; padding: 2px; text-overflow: ellipsis; color: var(--color-ink-3); }
	.prompt pre { max-height: 320px; margin: 4px 0 0; overflow: auto; border-radius: 8px; background: #101012; padding: 12px; color: var(--color-ink-2); font: 11.5px/1.6 var(--font-mono); white-space: pre-wrap; }
	.rd { background: #101012; }
	.rd .cp[data-state='completed'] { color: var(--color-teal); }
	.rd .cp[data-state='queued'], .rd .cp[data-state='in_progress'] { color: #7fb2ff; }
	.rd .cp[data-state='failed'], .rd .cp[data-state='nsfw'] { color: #ff7a6b; }
	.rd a { color: var(--color-teal); text-decoration: none; }
	.key.agent { background: var(--color-agent-purple-deep); color: #ddd6fe; }
	.sr { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
	@media (max-width: 640px) { .lg { flex-wrap: wrap; } .steps { display: none; } }
</style>
