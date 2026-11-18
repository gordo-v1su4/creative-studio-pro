<script lang="ts">
	import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';

	/**
	 * Centers the board on its beats once the requested project's nodes are measured.
	 * Lives inside <SvelteFlow>; the page sets `request` when a project opens and clears it in `done`.
	 * With `focus` set (a card id), it frames that one shot instead, e.g. after a click in the Bin.
	 */
	let { request, focus = null, done }: { request: string | null; focus?: string | null; done: () => void } = $props();
	const flow = useSvelteFlow();
	const initialized = useNodesInitialized();

	$effect(() => {
		if (!(request || focus) || !initialized.current) return;
		if (focus && flow.getNode(focus)) void flow.fitView({ nodes: [{ id: focus }], padding: 0.6, maxZoom: 1.1, duration: 300 });
		else void flow.fitView({ padding: 0.12, maxZoom: 1 });
		done();
	});
</script>
