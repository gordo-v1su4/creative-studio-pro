<script lang="ts">
	import { BaseEdge, EdgeReconnectAnchor, getBezierPath, type EdgeProps } from '@xyflow/svelte';

	/**
	 * A spine connector. Select it to show grab points at both ends: drag an end
	 * onto another beat to rehook it, or onto empty canvas to unhook it.
	 */
	let { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style }: EdgeProps = $props();
	let [path] = $derived(getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }));
	let reconnecting = $state(false);
</script>

{#if !reconnecting}
	<BaseEdge {path} {markerEnd} {style} />
{/if}
{#if selected}
	<EdgeReconnectAnchor bind:reconnecting type="source" position={{ x: sourceX, y: sourceY }} class="spine-anchor" />
	<EdgeReconnectAnchor bind:reconnecting type="target" position={{ x: targetX, y: targetY }} class="spine-anchor" />
{/if}

<style>
	:global(.spine-anchor) { border: 1px solid #55dfd5; border-radius: 50%; background: rgba(85, 223, 213, .14); cursor: grab; }
</style>
