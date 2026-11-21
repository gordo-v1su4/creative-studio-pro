<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import ClipHoverPlayer from '$lib/ui/ClipHoverPlayer.svelte';
	import { referenceImageUrl } from '$lib/media/reference-images';

	/**
	 * One scene on an assembly's canvas: its name, shot count and running time, and four glimpses of its
	 * picks (first, early middle, late middle, last) so its opening, middle and end read at a glance.
	 * Hover a glimpse to play it. Benched shots are counted but do not play.
	 */
	type Glimpse = { card_id: string; title: string; kind: 'video' | 'image' | null; url: string | null; in_s?: number | null; out_s?: number | null };
	type SceneNodeData = {
		name: string;
		shots: number;
		benched: number;
		seconds: number;
		glimpses: Glimpse[];
		onRemove?: () => void;
		onOpen?: () => void;
	};
	let { data, selected }: NodeProps & { data: SceneNodeData } = $props();
	const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<article class={['scene-node', selected && 'selected']} aria-label={`Scene ${data.name}, ${data.shots} shots`} ondblclick={() => data.onOpen?.()} title="Double-click to go inside this scene">
	<!-- The scene's own shot graph is one double-click away; ← back returns to the assembly. -->
	<header>
		<b class="min-w-0 grow truncate" title={data.name}>{data.name}</b>
		<small>{data.shots - data.benched} shots · {time(data.seconds)}{data.benched ? ` · ${data.benched} benched` : ''}</small>
		{#if data.onOpen}<button type="button" class="nodrag" onclick={data.onOpen} title="Go inside this scene (or double-click the node)">open ↘</button>{/if}
		{#if data.onRemove}<button type="button" class="nodrag" onclick={data.onRemove} title="Take this scene out of the assembly (its shots stay in the scene)" aria-label={`Remove ${data.name} from the assembly`}>×</button>{/if}
	</header>
	<div class="glimpses">
		{#each data.glimpses as glimpse (glimpse.card_id)}
			<figure title={glimpse.title}>
				{#if glimpse.kind === 'video' && glimpse.url}
					<ClipHoverPlayer src={glimpse.url} label={glimpse.title} maxHeight={144} inS={glimpse.in_s ?? null} outS={glimpse.out_s ?? null} />
				{:else if glimpse.kind === 'image' && glimpse.url}
					<img src={referenceImageUrl(glimpse.url, 'small')} alt={glimpse.title} />
				{:else}
					<span class="none">no take</span>
				{/if}
			</figure>
		{:else}
			<span class="none wide">No shots in this scene yet</span>
		{/each}
	</div>
</article>

<style>
	.scene-node { width: 1120px; display: grid; gap: 10px; padding: 14px 14px 16px; border: 1px solid #29434a; background: #0b1114; color: #cfe3e6; }
	.scene-node.selected { border-color: #59d9cf; box-shadow: 0 0 0 1px #59d9cf; background: #0d1719; }
	header { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
	header b { font-size: 15px; font-weight: 600; color: #e6f4f5; }
	header small { flex: none; color: #789da7; font: 11px var(--font-mono); }
	header button { flex: none; border: 1px solid #223039; background: transparent; color: #8fb6bd; padding: 1px 7px; font: 10px var(--font-mono); cursor: pointer; }
	header button:hover { border-color: #31565d; color: #cfe3e6; }
	.glimpses { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
	figure { margin: 0; aspect-ratio: 16 / 9; overflow: hidden; background: #05080a; border: 1px solid #172227; }
	figure :global(canvas), figure img { display: block; width: 100%; height: 100%; object-fit: cover; }
	.none { display: grid; place-items: center; height: 100%; color: #5b6b70; font: 600 9px var(--font-mono); text-transform: uppercase; }
	.wide { grid-column: 1 / -1; aspect-ratio: auto; padding: 24px 0; }
</style>
