<script lang="ts">
	/**
	 * A prompt in the sections of the skill that wrote it (DESIGN.md: Prompt view): one row per section, its label in
	 * chrome and its text on one line, with the skill's name and its check beside the title. Choosing a row shows that
	 * section in full in the editor underneath, which is always there, so nothing moves when a row is chosen.
	 */
	import type { PromptSection } from '$lib/domain/prompt-sections';

	let { title, skill, sections, scope, check = null, readonly = false, onedit }: {
		title: string;
		/** The skill that wrote it, e.g. Ghost. */
		skill: string;
		sections: PromptSection[];
		/** What the sections belong to (the shot): a new scope starts from the first row again. */
		scope: string;
		/** The skill's check on this prompt: a short result and, when there is something to fix, what. */
		check?: { label: string; tone: 'clean' | 'fix' | 'note'; lines?: string[] } | null;
		readonly?: boolean;
		onedit?: (key: string, text: string) => void;
	} = $props();

	let chosen = $state<{ scope: string; key: string } | null>(null);
	const current = $derived(sections.find((section) => chosen?.scope === scope && section.key === chosen.key) ?? sections[0] ?? null);
	/** What is being typed, kept as typed (the sections themselves come back trimmed). */
	let typing = $state<{ id: string; text: string } | null>(null);
	const id = $derived(`${scope}:${current?.key ?? ''}`);
	const shown = $derived(typing?.id === id ? typing.text : (current?.text ?? ''));

	function edit(text: string) {
		if (!current || readonly) return;
		typing = { id, text };
		onedit?.(current.key, text);
	}
</script>

<div class="prompt">
	<p class="cp head"><span class="title">{title}</span><span class="skill">{skill}</span>{#if check}<span class="check" data-tone={check.tone}>{check.label}</span>{/if}</p>
	<div class="rows">
		{#each sections as section (section.key)}
			<button type="button" class="row" aria-pressed={section.key === current?.key} class:missing={section.missing} title={section.text} onclick={() => { chosen = { scope, key: section.key }; typing = null; }}>
				<span class="cp">{section.label}</span><span class="text">{section.missing ? 'Missing' : section.text}</span>
			</button>
		{/each}
	</div>
	<textarea rows="5" value={shown} {readonly} aria-label={`${title}: ${current?.label ?? ''}`} oninput={(event) => edit(event.currentTarget.value)}></textarea>
	{#if check?.lines?.length}
		<ul class="found">{#each check.lines as line, i (i)}<li>{line}</li>{/each}</ul>
	{/if}
</div>

<style>
	.prompt { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
	.head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 2px; overflow: hidden; color: var(--color-ink-3); }
	.title { color: var(--color-ink-2); }
	.skill { color: var(--color-agent-pink); }
	.check { margin-left: auto; overflow: hidden; text-overflow: ellipsis; }
	.check[data-tone='clean'] { color: var(--color-teal); }
	.check[data-tone='fix'] { color: #ff7a6b; }
	.check[data-tone='note'] { color: var(--color-amber); }
	.rows { display: flex; flex-direction: column; }
	.row { display: flex; height: 20px; min-width: 0; align-items: center; gap: 8px; overflow: hidden; border: 0; border-radius: 4px; background: none; padding: 0 6px; text-align: left; cursor: pointer; }
	.row .cp { width: 76px; flex: none; overflow: hidden; text-overflow: ellipsis; color: var(--color-teal); }
	.row .text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-ink-2); font-size: 12px; }
	.row[aria-pressed='true'] { background: var(--color-selected); }
	.row[aria-pressed='true'] .text { color: var(--color-teal-ink); }
	.row.missing .text { color: #ff7a6b; }
	.row:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -2px; }
	textarea { margin-top: 3px; resize: vertical; border: 0; border-radius: 6px; background: var(--color-raised); padding: 6px 8px; color: var(--color-ink); font: 12px/1.5 var(--font-sans); }
	textarea:read-only { color: var(--color-ink-2); }
	textarea:focus-visible { outline: 2px solid var(--color-teal); outline-offset: -1px; }
	.found { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; padding: 0; list-style: none; color: #ff7a6b; font-size: 11.5px; line-height: 1.45; }
</style>
