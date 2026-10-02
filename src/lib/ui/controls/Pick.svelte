<script lang="ts" module>
	export type PickOption<V extends string = string> = { value: V; label: string; hint?: string; disabled?: boolean };
</script>

<script lang="ts" generics="T extends string">
	/**
	 * The app's dropdown: a slim key showing the choice, opening a hairline list.
	 * Never the browser's default select. The list is fixed-positioned so a
	 * scrolling panel or the board can't clip it; it opens upward near the
	 * bottom of the window. Keys: ↑/↓ move, Enter picks, Esc closes.
	 */
	let { value = $bindable(), options, label, placeholder = 'Pick…', disabled = false, wide = false, onchange }: {
		value?: T; options: PickOption<T>[]; label: string; placeholder?: string; disabled?: boolean; wide?: boolean; onchange?: (value: T) => void;
	} = $props();

	let open = $state(false);
	let active = $state(0);
	let button = $state<HTMLButtonElement>();
	let list = $state<HTMLUListElement>();
	let place = $state({ left: 0, top: 0, width: 0, up: false });
	const id = `pick-${Math.random().toString(36).slice(2, 9)}`;
	const chosen = $derived(options.find((option) => option.value === value));

	function show() {
		if (disabled || !button) return;
		const rect = button.getBoundingClientRect();
		const up = window.innerHeight - rect.bottom < Math.min(260, options.length * 24 + 12) && rect.top > window.innerHeight - rect.bottom;
		place = { left: rect.left, top: up ? rect.top - 3 : rect.bottom + 3, width: rect.width, up };
		active = Math.max(0, options.findIndex((option) => option.value === value));
		open = true;
		queueMicrotask(() => list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
	}

	function choose(i: number) {
		const option = options[i];
		if (!option || option.disabled) return;
		open = false;
		button?.focus();
		if (option.value === value) return;
		value = option.value;
		onchange?.(option.value);
	}

	function move(by: number) {
		for (let step = 1; step <= options.length; step++) {
			const next = (active + by * step + options.length * step) % options.length;
			if (!options[next]?.disabled) { active = next; break; }
		}
		list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function key(event: KeyboardEvent) {
		if (!open) {
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); show(); }
			return;
		}
		event.stopPropagation();
		if (event.key === 'Escape' || event.key === 'Tab') { open = false; if (event.key === 'Escape') event.preventDefault(); }
		else if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
		else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
		else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
	}

	function outside(event: PointerEvent) {
		if (open && !button?.contains(event.target as Node) && !list?.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={outside} onresize={() => (open = false)} />

<button
	bind:this={button}
	type="button"
	class={['pick', wide && 'wide', open && 'open']}
	{disabled}
	aria-label={label}
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-controls={id}
	onclick={() => (open ? (open = false) : show())}
	onkeydown={key}
>
	<span class={['text', !chosen && 'empty']}>{chosen?.label ?? placeholder}</span>
	<span class="caret" aria-hidden="true"></span>
</button>

{#if open}
	<ul
		bind:this={list}
		{id}
		role="listbox"
		aria-label={label}
		class={['pick-list', place.up && 'up']}
		style:left={`${place.left}px`}
		style:top={`${place.top}px`}
		style:min-width={`${place.width}px`}
	>
		{#each options as option, i (option.value)}
			<li
				role="option"
				data-i={i}
				aria-selected={option.value === value}
				aria-disabled={option.disabled}
				class={['opt', i === active && 'active', option.value === value && 'chosen', option.disabled && 'off']}
				onpointerenter={() => { if (!option.disabled) active = i; }}
				onpointerdown={(event) => { event.preventDefault(); choose(i); }}
			>
				<span>{option.label}</span>{#if option.hint}<small>{option.hint}</small>{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.pick { display: inline-flex; min-width: 0; max-width: 280px; align-items: center; gap: 8px; height: 22px; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); padding: 0 7px 0 8px; color: var(--color-nr-ink); font: 500 11px var(--font-sans); text-align: left; transition: border-color 140ms ease; }
	.pick.wide { width: 100%; max-width: none; height: 30px; }
	.pick:hover:not(:disabled), .pick.open, .pick:focus-visible { border-color: color-mix(in srgb, var(--color-nr-accent) 50%, transparent); outline: none; }
	.pick:disabled { opacity: 0.45; }
	.text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.text.empty { color: var(--color-nr-faint); }
	.caret { flex: none; width: 5px; height: 5px; margin-top: -3px; border-right: 1px solid var(--color-nr-dim); border-bottom: 1px solid var(--color-nr-dim); transform: rotate(45deg); transition: transform 140ms ease; }
	.pick.open .caret { margin-top: 3px; transform: rotate(225deg); }
	.pick-list { position: fixed; z-index: 1000; max-width: 420px; max-height: 260px; overflow-y: auto; margin: 0; padding: 3px 0; list-style: none; border: 1px solid var(--color-nr-line); border-radius: 2px; background: var(--color-nr-deep); box-shadow: 0 10px 28px rgb(0 0 0 / 0.55); font: 500 11px var(--font-sans); animation: pick-in 110ms ease-out; }
	.pick-list.up { transform: translateY(-100%); }
	.opt { display: flex; align-items: baseline; gap: 10px; padding: 4px 10px; color: var(--color-nr-muted); cursor: default; white-space: nowrap; }
	.opt small { margin-left: auto; color: var(--color-nr-faint); font: 10px var(--font-mono); }
	.opt.active { background: var(--color-nr-raised); color: var(--color-nr-ink); }
	.opt.chosen { color: var(--color-nr-accent); box-shadow: inset 2px 0 0 var(--color-nr-accent); }
	.opt.off { opacity: 0.4; }
	@keyframes pick-in { from { opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .pick-list { animation: none; } .caret { transition: none; } }
</style>
