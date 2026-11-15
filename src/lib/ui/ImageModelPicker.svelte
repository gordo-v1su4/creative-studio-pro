<script lang="ts">
	import { IMAGE_MODEL_IDS, imageModelOption, type ImageModelId } from '$lib/domain/image-models';
	let { value, name, disabled = false, onchange }: { value: ImageModelId; name: string; disabled?: boolean; onchange: (model: ImageModelId) => void } = $props();
	function escape(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		const picker = (event.currentTarget as HTMLElement).closest('details')!;
		picker.open = false;
		picker.querySelector('summary')?.focus();
	}
</script>

<details class="picker" onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }}>
	<summary aria-label={`Image model for ${name}`} aria-disabled={disabled} tabindex={disabled ? -1 : 0} onkeydown={escape} onclick={(event) => { if (disabled) event.preventDefault(); }}>{imageModelOption(value)}<span aria-hidden="true">⌄</span></summary>
	<div class="choices" role="group" aria-label={`Higgsfield image models for ${name}`}>
		{#each IMAGE_MODEL_IDS as model (model)}
			<button type="button" {disabled} aria-pressed={value === model} onkeydown={escape} onclick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement).open = false; onchange(model); }}>{imageModelOption(model)}<span aria-hidden="true">{value === model ? '✓' : ''}</span></button>
		{/each}
	</div>
</details>

<style>
	.picker { position:relative; min-width:0; width:100%; color:var(--color-nr-ink); font:10px var(--font-mono); }
	summary { display:flex; align-items:center; justify-content:space-between; gap:8px; list-style:none; cursor:pointer; min-height:28px; padding:5px 8px; border:1px solid var(--color-nr-line); border-radius:2px; background:var(--color-nr-deep); }
	summary::-webkit-details-marker { display:none; }
	summary[aria-disabled='true'] { opacity:.5; cursor:default; }
	.choices { position:absolute; z-index:30; left:0; right:0; margin-top:4px; padding:4px; background:#10151b; border:1px solid var(--color-nr-line); box-shadow:0 8px 24px #0008; border-radius:2px; }
	button { display:flex; justify-content:space-between; align-items:center; gap:8px; width:100%; min-height:34px; padding:8px; text-align:left; font:inherit; color:var(--color-nr-ink); background:#10151b; border:1px solid transparent; cursor:pointer; }
	button[aria-pressed='true'] { background:#17352e; color:#d8f6e7; }
	button:hover,button:focus-visible { background:#20332f; border-color:#5f9486; outline:none; }
	summary:focus-visible { outline:2px solid var(--color-nr-accent); outline-offset:2px; }
</style>
