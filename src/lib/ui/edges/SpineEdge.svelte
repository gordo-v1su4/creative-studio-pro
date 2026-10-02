<script lang="ts">
	import { BaseEdge, EdgeLabel, EdgeReconnectAnchor, getBezierPath, useSvelteFlow, type EdgeProps } from '@xyflow/svelte';

	/**
	 * A spine connector. Click it to select it: an Unhook key appears on the line
	 * and grab points at both ends. Unhook (or Delete) removes the link; drag an
	 * end onto another beat to rehook it there, or onto empty canvas to unhook it.
	 */
	let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps = $props();
	let [path, labelX, labelY] = $derived(getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }));
	let reconnecting = $state(false);
	const flow = useSvelteFlow();
</script>

{#if !reconnecting}
	<BaseEdge {path} {markerEnd} style={selected ? `${style ?? ''};stroke:var(--color-nr-accent);stroke-width:2` : style} interactionWidth={24} />
{/if}
{#if selected && !reconnecting}
	<EdgeLabel x={labelX} y={labelY} transparent selectEdgeOnClick={false}>
		<button type="button" class="unhook nodrag nopan" onclick={() => void flow.deleteElements({ edges: [{ id }] })} title="Unhook this link (Delete). To hook it elsewhere, drag one of its round ends onto another beat.">× Unhook</button>
	</EdgeLabel>
{/if}
{#if selected}
	<EdgeReconnectAnchor bind:reconnecting type="source" size={22} position={{ x: sourceX, y: sourceY }} class="spine-anchor" />
	<EdgeReconnectAnchor bind:reconnecting type="target" size={22} position={{ x: targetX, y: targetY }} class="spine-anchor" />
{/if}

<style>
	:global(.spine-anchor) { border: 1px solid var(--color-nr-accent); border-radius: 50%; background: color-mix(in srgb, var(--color-nr-accent) 14%, transparent); cursor: grab; }
	:global(.spine-anchor:hover) { background: color-mix(in srgb, var(--color-nr-accent) 30%, transparent); }
	.unhook { pointer-events: all; border: 1px solid color-mix(in srgb, var(--color-nr-accent) 55%, transparent); border-radius: 2px; background: var(--color-nr-deep); padding: 0 7px; color: var(--color-nr-accent); font: 600 9px/18px var(--font-sans); letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; cursor: pointer; }
	.unhook:hover { border-color: var(--color-gate-failed, #ff7b7b); color: var(--color-gate-failed, #ff7b7b); }
</style>
