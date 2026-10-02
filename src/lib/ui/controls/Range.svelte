<script lang="ts">
	/**
	 * The app's slider: a fine groove with faint quarter marks, a hairline fill
	 * that fades in toward the value (teal → blue), and a small slim cap for the
	 * thumb. Never the browser's default slider.
	 */
	let { value = $bindable(0), min = 0, max = 1, step = 0.01, label, oninput, onchange }: {
		value?: number; min?: number; max?: number; step?: number; label: string; oninput?: () => void; onchange?: () => void;
	} = $props();

	const fill = $derived(`${Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100))}%`);
</script>

<input type="range" class="range" {min} {max} {step} bind:value {oninput} {onchange} aria-label={label} style:--fill={fill} />

<style>
	.range {
		--groove:
			linear-gradient(90deg, rgba(78, 232, 210, 0) 0%, rgba(78, 232, 210, 0.35) 55%, rgba(74, 184, 255, 0.85) 100%) 0 50% / var(--fill) 1px no-repeat,
			linear-gradient(90deg, transparent calc(25% - 1px), #262c31 calc(25% - 1px) 25%, transparent 25% calc(50% - 1px), #262c31 calc(50% - 1px) 50%, transparent 50% calc(75% - 1px), #262c31 calc(75% - 1px) 75%, transparent 75%),
			#0c0e10;
		width: 100%;
		height: 16px;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		cursor: ew-resize;
	}
	.range::-webkit-slider-runnable-track {
		height: 2px;
		background: var(--groove);
		box-shadow: 0 1px 0 #1a1f23;
	}
	.range::-moz-range-track {
		height: 2px;
		background: var(--groove);
		box-shadow: 0 1px 0 #1a1f23;
	}
	.range::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 7px;
		height: 14px;
		margin-top: -6px;
		border: 1px solid #4b555c;
		border-radius: 1.5px;
		background: linear-gradient(180deg, #3a4146, #2a3035);
		transition: border-color 120ms ease;
	}
	.range::-moz-range-thumb {
		width: 7px;
		height: 14px;
		border: 1px solid #4b555c;
		border-radius: 1.5px;
		background: linear-gradient(180deg, #3a4146, #2a3035);
	}
	.range:hover::-webkit-slider-thumb, .range:active::-webkit-slider-thumb, .range:focus-visible::-webkit-slider-thumb { border-color: #7de5dc; }
	.range:focus-visible { outline: none; }
</style>
