<script lang="ts">
	import { ui } from '$lib/ui/app-state.svelte';

	let chip = $derived.by(() => {
		if (!ui.capabilitiesChecked) return { label: 'NOT CHECKED', color: 'var(--color-capability-offline)' };
		const available = ui.capabilities.filter((c) => c.state === 'available').length;
		const offline = ui.capabilities.filter((c) => c.state === 'offline' || c.state === 'degraded').length;
		return {
			label: `${available}/${ui.capabilities.length} UP`,
			color: offline > 0 ? 'var(--color-gate-pending)' : 'var(--color-gate-approved)'
		};
	});
</script>

<button
	type="button"
	class="chip meta-label cursor-pointer transition-colors hover:border-text-dim"
	style:color={chip.color}
	onclick={() => (ui.capabilitiesOpen = !ui.capabilitiesOpen)}
	title="Open Capability Drawer"
>
	<span class="mr-1.5 block h-1.5 w-1.5 rounded-full" style:background={chip.color}></span>
	{chip.label}
</button>
