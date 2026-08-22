<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	type Msg = { id: number; role: 'user' | 'agent'; text: string };

	let { open = $bindable(false), projectTitle = '' }: { open?: boolean; projectTitle?: string } =
		$props();

	let messages = $state<Msg[]>([
		{
			id: 0,
			role: 'agent',
			text: "hey! i'm the studio agent ✦ the M3 bridge isn't wired up yet, so i can't run models — but i can hold notes against your seed while you sketch."
		}
	]);
	let draft = $state('');
	let thinking = $state(false);
	let spinnerFrame = $state('⠋');
	let scroller = $state<HTMLDivElement>();
	let nextId = 1;

	const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
	const timers = new Set<ReturnType<typeof setInterval>>();

	// Staged persona until a real agent endpoint exists (Phase 1+).
	const cannedReplies = [
		'noted ✦ once the M3 Raycast bridge returns a live catalog, i can route this to the creative room. until then it stays draft-only in S0.',
		"filed against the seed. no model names promised — the roster resolves when the catalog is real. anything else brewing?",
		'got it. S0 intake keeps everything reversible, so riff freely — nothing is spent until a gate approves it.'
	];
	let replyIndex = 0;

	function clearTimers() {
		for (const t of timers) clearInterval(t);
		timers.clear();
	}

	onDestroy(clearTimers);

	async function scrollToEnd() {
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
	}

	function send() {
		const text = draft.trim();
		if (!text || thinking) return;
		messages.push({ id: nextId++, role: 'user', text });
		draft = '';
		void scrollToEnd();

		thinking = true;
		let frame = 0;
		const spin = setInterval(() => {
			spinnerFrame = spinnerFrames[++frame % spinnerFrames.length];
		}, 80);
		timers.add(spin);

		const reply = cannedReplies[replyIndex++ % cannedReplies.length];
		setTimeout(() => {
			clearInterval(spin);
			timers.delete(spin);
			thinking = false;
			messages.push({ id: nextId++, role: 'agent', text: '' });
			const idx = messages.length - 1;
			let i = 0;
			const typewriter = setInterval(() => {
				messages[idx].text = reply.slice(0, ++i);
				void scrollToEnd();
				if (i >= reply.length) {
					clearInterval(typewriter);
					timers.delete(typewriter);
				}
			}, 16);
			timers.add(typewriter);
		}, 850);
	}
</script>

{#if open}
	<aside
		class="fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-[92vw] flex-col border-l border-border-default bg-surface-raised shadow-[-16px_0_48px_rgba(0,0,0,0.55)]"
		transition:fly={{ x: 420, duration: 380, easing: quintOut }}
		aria-label="Agent chat"
	>
		<!-- Gradient spine on the drawer edge -->
		<span
			class="pointer-events-none absolute inset-y-0 left-0 w-px opacity-60 bg-[linear-gradient(180deg,var(--color-charm-pink),var(--color-charm-purple),var(--color-charm-mint))]"
		></span>

		<header class="flex items-center gap-2 border-b border-border-subtle px-3.5 py-3">
			<span class="font-mono text-[13px] text-text-dim">╭─</span>
			<span class="font-mono text-[12px] font-semibold tracking-[0.08em] uppercase text-text-primary">
				<span class="charm-gradient-text">✦</span> agent
			</span>
			<span class="grow"></span>
			<span
				class="chip meta-label border-[color-mix(in_srgb,var(--color-charm-purple)_30%,var(--color-border-default))] text-text-dim"
			>
				OFFLINE · NO CATALOG
			</span>
			<button
				type="button"
				class="btn px-2 py-1 font-mono text-[11px]"
				onclick={() => (open = false)}
				aria-label="Close agent chat"
			>
				esc
			</button>
		</header>

		{#if projectTitle}
			<div class="border-b border-border-subtle px-3.5 py-2 font-mono text-[11px] text-text-dim">
				<span class="text-charm-mint">❯</span> context: <span class="text-text-muted">{projectTitle}</span>
			</div>
		{/if}

		<div bind:this={scroller} class="grow space-y-3 overflow-y-auto px-3.5 py-4">
			{#each messages as msg (msg.id)}
				<div
					class={['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']}
					in:fly={{ y: 10, duration: 220, easing: quintOut }}
				>
					<div
						class={[
							'max-w-[85%] rounded-md px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary',
							msg.role === 'user'
								? 'rounded-br-[2px] border border-[color-mix(in_srgb,var(--color-charm-pink)_28%,var(--color-border-default))] bg-surface-raised-2'
								: 'rounded-bl-[2px] border border-border-default bg-surface-raised-2'
						]}
					>
						{#if msg.role === 'agent'}
							<span class="meta-label mb-1 block text-charm-mint">agent</span>
						{/if}
						{msg.text}
					</div>
				</div>
			{/each}

			{#if thinking}
				<div class="flex items-center gap-2 font-mono text-[12px] text-charm-purple" aria-live="polite">
					<span class="text-[14px]">{spinnerFrame}</span>
					<span class="text-text-dim">brewing…</span>
				</div>
			{/if}
		</div>

		<form
			class="border-t border-border-subtle px-3.5 py-3"
			onsubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			<div class="charm-ring flex items-center gap-2 rounded-md bg-surface-base px-3 py-2">
				<span class="charm-gradient-text font-mono text-[13px] font-bold">❯</span>
				<input
					{@attach (node: HTMLInputElement) => node.focus()}
					bind:value={draft}
					class="grow bg-transparent font-mono text-[12px] text-text-primary outline-none placeholder:text-text-dim"
					style="caret-color: var(--color-charm-mint)"
					placeholder="tell the agent something…"
					aria-label="Message the agent"
				/>
				{#if !draft}<span class="charm-cursor" aria-hidden="true"></span>{/if}
			</div>
			<div class="mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.06em] text-text-dim">
				<span><b class="text-text-muted">enter</b> send · <b class="text-text-muted">esc</b> close</span>
				<span class="text-text-dim">╰─</span>
			</div>
		</form>
	</aside>
{/if}
