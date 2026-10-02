<script lang="ts">
	/**
	 * The app's on/off control: a small, quiet key that lights teal when on.
	 * Never a browser checkbox.
	 */
	let { checked = $bindable(false), label, on = 'on', off = 'off', onchange }: {
		checked?: boolean; label: string; on?: string; off?: string; onchange?: (checked: boolean) => void;
	} = $props();

	function flip() {
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button type="button" role="switch" aria-checked={checked} aria-label={label} class={['key', checked && 'lit']} onclick={flip}>{checked ? on : off}</button>

<style>
	.key {
		flex: none;
		border: 1px solid #262c31;
		border-radius: 2px;
		background: transparent;
		padding: 0 4px;
		line-height: 14px;
		color: #59646b;
		font: 600 9px/14px var(--font-sans);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		cursor: pointer;
		transition: border-color 140ms ease, color 140ms ease;
	}
	.key:hover { color: #8a969e; }
	.key.lit { border-color: rgba(78, 232, 210, 0.45); color: #7de5dc; }
	.key:focus-visible { outline: 1px solid #4ee8d2; outline-offset: 1px; }
	@media (prefers-reduced-motion: reduce) { .key { transition: none; } }
</style>
