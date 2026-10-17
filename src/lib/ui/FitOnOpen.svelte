<script lang="ts">
	import { useNodesInitialized, useSvelteFlow } from '@xyflow/svelte';

	/**
	 * Centers the board on its beats once the requested project's nodes are measured.
	 * Lives inside <SvelteFlow>; the page sets `request` when a project opens and clears it in `done`.
	 */
	let { request, done }: { request: string | null; done: () => void } = $props();
	const flow = useSvelteFlow();
	const initialized = useNodesInitialized();

	$effect(() => {
		if (!request || !initialized.current) return;
		void flow.fitView({ padding: 0.12, maxZoom: 1 });
		done();
	});
</script>
