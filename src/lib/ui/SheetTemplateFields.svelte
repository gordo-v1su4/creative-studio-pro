<script lang="ts">
	import { untrack } from 'svelte';
	import { characterSheetInputsSchema, CHARACTER_SHEET_TEMPLATE, type CharacterSheetInputs } from '$lib/domain/character-sheet';
	let { value, sources, primary, busy, ondirty, onsave }: { value?: CharacterSheetInputs; sources: Array<{url:string;name:string}>; primary?: string | null; busy: boolean; ondirty: (dirty:boolean) => void; onsave: (input:CharacterSheetInputs) => Promise<boolean> } = $props();
	let fields = $state(untrack(() => structuredClone(value ?? characterSheetInputsSchema.parse({}))));
	let dirty = $state(false);
	function changed() { dirty = true; ondirty(true); }
	async function save() { if (await onsave($state.snapshot(fields))) { dirty = false; ondirty(false); } }
</script>

<div class="fields">
	<p>Fixed template · {CHARACTER_SHEET_TEMPLATE}. Only these fields change. Scene photos, portraits and existing sheets use the same panel instructions.</p>
	<label>Subject in the identity reference<input bind:value={fields.subject} oninput={changed} maxlength="300" disabled={busy} placeholder="the foreground woman with the dark bob" /></label>
	<label>Optional outfit/body reference<select bind:value={fields.wardrobe_source_url} onchange={changed} disabled={busy}><option value={null}>Use the identity reference only</option>{#each sources.filter(source => source.url !== primary) as source (source.url)}<option value={source.url}>{source.name}</option>{/each}</select></label>
	<label>Requested changes and missing details<textarea bind:value={fields.direction} oninput={changed} rows="3" maxlength="2000" disabled={busy}></textarea></label>
	<p>If the reference hides the body, shoes or outfit, supply those details or attach a second reference. Specify whether temporary injuries, makeup or accessories should change. These fields are used exactly as written.</p>
	<label class="check"><input type="checkbox" bind:checked={fields.coverage_confirmed} onchange={changed} disabled={busy} />The subject is clearly identified, and the references and supplied details cover the intended body and outfit. Unresolved details need review before generation.</label>
	<button type="button" disabled={busy || !fields.subject.trim() || !fields.direction.trim()} onclick={() => void save()}>{dirty || !value ? 'Save template fields' : 'Template fields saved'}</button>
</div>

<style>
	.fields { display:grid; gap:8px; font:11px/1.6 var(--font-sans); color:var(--color-nr-text); }
	p { color:var(--color-nr-muted); margin:0; }
	label { display:grid; gap:4px; }
	input,select,textarea { width:100%; min-width:0; padding:6px; border:1px solid var(--color-nr-line); border-radius:2px; background:var(--color-nr-deep); color:var(--color-nr-ink); font:inherit; }
	.check { display:flex; align-items:start; gap:7px; }
	.check input { width:auto; margin-top:4px; accent-color:var(--color-nr-accent); }
	button { padding:6px 8px; border:1px solid var(--color-nr-line); border-radius:2px; background:var(--color-nr-deep); color:var(--color-nr-ink); font:inherit; cursor:pointer; }
	:disabled { opacity:.5; cursor:default; }
	:is(input,select,textarea,button):focus-visible { outline:2px solid var(--color-nr-accent); outline-offset:2px; }
</style>
