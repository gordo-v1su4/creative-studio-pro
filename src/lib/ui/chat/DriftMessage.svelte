<script lang="ts">
	/**
	 * The drift check's one Agent message (Drift 03, GitHub #32 / V1S-510; ADR 0012): each item out of step, where it
	 * was found and where it is missing, with only its choices, as small actions. "Add to Notion" asks for the exact
	 * name first (straight apostrophes, no " - "); "link" and "mark as old" come with later tickets. In the chat's
	 * decided look: on the panel, no boxes, grey, with the Agent's name in purple. A picture under 2048 px (Drift 08)
	 * shows its size and offers an upscale, priced before anything is spent, or a remake; the upscaled sheet is shown
	 * beside the original and sent only on a second yes.
	 */
	import type { Project } from '$lib/domain/schemas';
	import { cleanName, type DriftChoice, type DriftItem } from '$lib/domain/drift';
	import type { PrepKind } from '$lib/domain/prep';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';

	let { project }: { project: Project } = $props();

	const report = $derived(agentWork.drift?.projectId === project.project_id ? agentWork.drift.report : null);
	const working = $derived(agentWork.busy !== null);
	const KINDS: Array<{ kind: PrepKind; title: string }> = [{ kind: 'character', title: 'Characters' }, { kind: 'location', title: 'Locations' }, { kind: 'prop', title: 'Props' }];
	const groups = $derived(report ? KINDS.map((group) => ({ ...group, items: report.items.filter((item) => item.kind === group.kind) })).filter((group) => group.items.length) : []);

	/** The item whose name is being settled before "add to Notion" writes it, and the name as typed. */
	let naming = $state<string | null>(null);
	let name = $state('');
	const written = $derived(cleanName(name));

	const LATER: Record<Exclude<DriftChoice, 'add_to_notion' | 'upscale' | 'remake'>, string> = { link: 'Linking comes with a later step', mark_old: 'Marking a Review Room sheet as old comes with a later step' };
	const PLACES = { notion: 'Notion', review_room: 'Review Room' } as const;

	function where(item: DriftItem): string {
		if (item.picture) return `Its sheet in ${item.found.prep[0]?.project_title ?? 'this'}'s Prep is ${item.picture.width}×${item.picture.height}; Review Room takes 2048 px or more on the long edge.`;
		const found = [
			...item.found.prep.map((at) => `${at.project_title}'s Prep`),
			...(item.found.review_room ? [`Review Room (${item.found.review_room.code})`] : [])
		];
		const list = (parts: string[], last: string) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${last} ${parts.at(-1)}` : parts[0] ?? '');
		return `In ${list(found, 'and')}; not in ${list(item.missing.map((place) => PLACES[place]), 'or')}.`;
	}

	const step = (item: DriftItem) => agentWork.pictures[item.key] ?? null;
	const notYet = 'Add it to Notion first; the upscaled sheet waits here until then';
	function dropStep(item: DriftItem) { const { [item.key]: _gone, ...rest } = agentWork.pictures; agentWork.pictures = rest; }

	/** The operator's yes to the upscale's price, posted from this press itself: the Agent never confirms a spend (decision 17). */
	function yesUpscale(item: DriftItem, credits: number) {
		const picture = item.picture;
		if (!picture) return;
		void agentWork.upscale(project, item, credits, async () => {
			const response = await fetch(`/api/projects/${picture.project_id}/drift`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'upscale', key: picture.entry_key, confirmed_credits: credits }) });
			const answer = (await response.json().catch(() => null)) as { ok: boolean; error?: { message?: string } } | null;
			if (!answer?.ok) throw new Error(answer?.error?.message ?? `The upscale was not sent (HTTP ${response.status})`);
		});
	}

	function startAdd(item: DriftItem) { naming = item.key; name = item.name; }
	async function add(item: DriftItem) {
		if (!written) return;
		const settled = written;
		naming = null;
		await agentWork.addToNotion(project, item, settled);
	}
</script>

{#if report}
	<section class="drift" aria-label="What is out of step">
		<span class="cp who">Agent</span>
		<p class="lead">{report.items.length === 1 ? 'One thing is' : `${report.items.length} things are`} out of step between Notion, Prep and Review Room in {report.series_title}. Nothing changes until you choose.</p>
		{#each groups as group (group.kind)}
			<p class="cp kind">{group.title}</p>
			<ul>
				{#each group.items as item (item.key)}
					<li>
						<p class="name">{item.name}{#if item.spellings.length > 1}<span class="also"> · spelled {item.spellings.join(' and ')}</span>{/if}</p>
						<p class="where">{where(item)}{#if item.link_to} Close to {item.link_to.name} in Notion.{/if}</p>
						{#if naming === item.key}
							<form class="naming" onsubmit={(event) => { event.preventDefault(); void add(item); }}>
								<input bind:value={name} aria-label="The exact name to write to Notion" maxlength="200" />
								<button type="submit" class="key" disabled={!written || working}>Add</button>
								<button type="button" class="tg" onclick={() => (naming = null)}>Cancel</button>
							</form>
							{#if written && written !== name.trim()}<p class="hint">Written as {written}</p>{/if}
						{:else if item.picture}
							{@const now = step(item)}
							{#if now?.stage === 'priced'}
								<p class="ask">Upscale to 2048 px for {now.credits} credit{now.credits === 1 ? '' : 's'}?</p>
								<div class="choices">
									<button type="button" class="tg" disabled={working} onclick={() => yesUpscale(item, now.credits)}>Yes, upscale</button>
									<button type="button" class="tg" onclick={() => dropStep(item)}>No</button>
								</div>
							{:else if now?.stage === 'upscaling'}
								<p class="hint">Upscaling for {now.credits} credit{now.credits === 1 ? '' : 's'}; it comes back here beside the original.</p>
							{:else if now?.stage === 'back'}
								<div class="pair">
									<figure><img src={now.original.url} alt="{item.name}, the original sheet" /><figcaption class="cp">Original {now.original.width}×{now.original.height}</figcaption></figure>
									<figure><img src={now.upscaled.url} alt="{item.name}, upscaled" /><figcaption class="cp">Upscaled {now.upscaled.width}×{now.upscaled.height}</figcaption></figure>
								</div>
								<div class="choices">
									<button type="button" class="tg" disabled={working || !item.picture.reference_page_id} title={item.picture.reference_page_id ? 'Send the upscaled sheet to Review Room under its Notion name' : notYet} onclick={() => void agentWork.sendUpscaled(project, item)}>Send to Review Room</button>
									<button type="button" class="tg" onclick={() => agentWork.remake(project, item)} title="Make a new sheet in Prep instead">Remake</button>
								</div>
							{:else if now?.stage === 'sent'}
								<p class="hint">In Review Room at {now.upscaled.width}×{now.upscaled.height}.</p>
							{:else}
								<div class="choices">
									<button type="button" class="tg" disabled={working} onclick={() => void agentWork.priceUpscale(project, item)} title="See the upscale's price first; nothing is spent until you say yes">Upscale</button>
									<button type="button" class="tg" onclick={() => agentWork.remake(project, item)} title="Make a new sheet in Prep; it is priced there before anything is spent">Remake</button>
								</div>
							{/if}
						{:else}
							<div class="choices">
								{#each item.choices as choice (choice)}
									{#if choice === 'add_to_notion'}
										<button type="button" class="tg" disabled={working} onclick={() => startAdd(item)} title="Write its Notion References page (Name and Kind), then list it in Prep. You can change the name first.">Add to Notion</button>
									{:else if choice === 'link' || choice === 'mark_old'}
										<button type="button" class="tg" disabled title={LATER[choice]}>{choice === 'link' ? `Link to ${item.link_to?.name ?? 'a reference'}` : 'Mark as old'}</button>
									{/if}
								{/each}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
	</section>
{/if}

<style>
	.drift { display: flex; flex: none; flex-direction: column; max-height: 46vh; overflow-y: auto; padding: 8px 10px 2px; color: #c8c8ce; font: 12.5px/1.5 var(--font-sans); scrollbar-color: #26262b transparent; }
	.who { display: block; margin-bottom: 3px; color: #8f86b8; }
	.lead { margin: 0 0 4px; }
	.kind { margin: 8px 0 2px; color: var(--color-ink-3); }
	ul { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
	li { display: flex; flex-direction: column; }
	.name { margin: 0; color: var(--color-ink); }
	.also, .where, .hint { color: var(--color-ink-3); }
	.where, .hint { margin: 0; font-size: 11.5px; }
	.choices { display: flex; flex-wrap: wrap; gap: 1px; margin: 1px 0 0 -6px; }
	.choices .tg:disabled { opacity: 0.45; cursor: default; }
	.ask { margin: 2px 0 0; color: var(--color-ink); }
	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 4px 0 2px; }
	.pair figure { margin: 0; min-width: 0; }
	.pair img { display: block; width: 100%; height: auto; border-radius: 6px; background: var(--color-raised); }
	.pair figcaption { margin-top: 2px; color: var(--color-ink-3); }
	.naming { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
	.naming input { min-width: 0; flex: 1; border: 0; border-radius: 6px; background: var(--color-raised); padding: 3px 8px; color: var(--color-ink); font: inherit; outline: none; }
	.naming input:focus-visible { outline: 2px solid var(--color-agent-purple); outline-offset: -1px; }
</style>
