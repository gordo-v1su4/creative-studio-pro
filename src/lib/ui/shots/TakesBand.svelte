<script lang="ts">
	/**
	 * The fixed band under the shot grid (DESIGN.md: Takes band): the selected shot's takes,
	 * each with its version, so they can be compared and the pick changed without anything moving.
	 */
	import type { Take } from '$lib/domain/takes';
	import type { ShotCardFacts } from '$lib/domain/shot-card';
	import { referenceImageUrl } from '$lib/media/reference-images';
	import { posterUrl } from '$lib/media/gpu/clipBanks';

	let { title, facts, takes, busy = false, onpick, onopen }: {
		/** The selected shot's title, or null when nothing is selected. */
		title: string | null;
		facts: ShotCardFacts | null;
		takes: Take[];
		busy?: boolean;
		onpick: (takeId: string) => void;
		onopen: () => void;
	} = $props();

	const still = (take: Take) => (take.kind === 'video' ? (posterUrl(take.url, take.in_s ?? 0) ?? '') : referenceImageUrl(take.url, 'small'));
</script>

<div class="band" aria-label="Takes of the selected shot">
	{#if !facts || title === null}
		<span class="cp hint">Select a shot to see its takes</span>
	{:else}
		<span class="who"><span class="cp">Takes</span><span class="code">{facts.code}</span></span>
		{#if facts.takes.length === 0}
			<span class="cp hint">No take yet</span>
		{:else}
			<div class="takes">
				{#each facts.takes as mark (mark.id)}
					{@const take = takes.find((item) => item.asset_id === mark.id)}
					<button type="button" class="take" class:pick={mark.pick} class:excluded={mark.excluded} disabled={busy || mark.pick || mark.excluded} title={`${mark.pick ? `${mark.name} is the pick` : mark.excluded ? `${mark.name} is excluded` : `Make ${mark.name} the pick`}${mark.file ? ` · ${mark.file}` : ''}`} onclick={() => onpick(mark.id)}>
						{#if take && still(take)}<img src={still(take)} alt="" loading="lazy" decoding="async" />{/if}
						<span class="code">{mark.label}{mark.pick ? ' pick' : ''}</span>
					</button>
				{/each}
			</div>
		{/if}
		<span class="name">{title}</span>
		<button type="button" class="key" onclick={onopen}>Details</button>
	{/if}
</div>

<style>
	.band { display: flex; height: 56px; flex: none; align-items: center; gap: 10px; overflow: hidden; border-radius: 8px; background: var(--color-raised); padding: 0 10px; white-space: nowrap; }
	.hint { color: var(--color-ink-3); }
	.who { display: flex; flex: none; flex-direction: column; gap: 1px; color: var(--color-ink); }
	.code { font: 10.5px var(--font-mono); letter-spacing: 0.01em; }
	.who .code { color: var(--color-ink-3); }
	.takes { display: flex; min-width: 0; gap: 3px; overflow-x: auto; scrollbar-width: none; }
	.take { position: relative; width: 66px; flex: none; aspect-ratio: 16 / 9; overflow: hidden; border: 0; border-radius: 4px; background: var(--color-control); padding: 0; cursor: pointer; }
	.take:disabled { cursor: default; }
	.take img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.take .code { position: absolute; bottom: 2px; left: 3px; border-radius: 2px; background: rgb(0 0 0 / 0.72); padding: 0 3px; color: var(--color-ink-2); }
	.take.pick .code { background: var(--color-teal-deep); color: var(--color-teal-ink); }
	.take.excluded img { opacity: 0.25; }
	.take.excluded .code { text-decoration: line-through; }
	.take:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	.name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; color: var(--color-ink-2); font-size: 12px; }
</style>
