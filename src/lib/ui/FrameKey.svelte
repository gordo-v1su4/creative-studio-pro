<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';

	/**
	 * F frames the board on the selected shots (one shot fills the view), or on everything when nothing is
	 * selected. Lives inside <SvelteFlow>. Ignored while typing in a field or with a modifier held.
	 */
	const flow = useSvelteFlow();

	function key(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
		const selected = flow.getNodes().filter((node) => node.selected);
		event.preventDefault();
		void flow.fitView({ nodes: selected.length ? selected.map((node) => ({ id: node.id })) : undefined, padding: selected.length === 1 ? 0.06 : 0.12, maxZoom: 4, duration: 280 });
	}
</script>

<svelte:window onkeydown={key} />
