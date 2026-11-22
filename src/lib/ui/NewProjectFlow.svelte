<script lang="ts">
	import { onMount } from 'svelte';
	let { onCreated, onClose }: { onCreated: (id: string) => Promise<void>; onClose: () => void } = $props();
	let path = $state<'need_idea' | 'have_idea' | 'have_story'>('have_story');
	let title = $state(''); let text = $state(''); let seriesId = $state(''); let root = $state(''); let sourceId = $state('');
	let busy = $state(false); let error = $state('');
	let series = $state<Array<{series_id: string; title: string}>>([]);
	let projects = $state<Array<{project_id: string; title: string}>>([]);
	let dialog: HTMLDialogElement;
	onMount(() => {
		dialog.showModal();
		void Promise.all([fetch('/api/series').then(response => response.json()), fetch('/api/projects').then(response => response.json())]).then(([shows, list]) => { series = shows.data?.series ?? []; projects = list.projects ?? []; }).catch(() => { error = 'Could not load existing sources. You can still paste your idea or story.'; });
	});
	async function create() {
		busy = true; error = '';
		try {
			const response = await fetch('/api/projects/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, title, text, ...(path === 'have_story' && seriesId ? {series_id:seriesId} : {}), ...(path === 'have_story' && root.trim() ? {notion_root:root.trim()} : {}), ...(sourceId ? {prep_source_project_id:sourceId} : {}) }) });
			const body = await response.json();
			if (!body.ok) throw new Error(body.error?.message ?? 'Could not start the project');
			await onCreated(body.data.project_id);
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not start the project'; }
		finally { busy = false; }
	}
</script>

<div class="shade">
<dialog class="start" bind:this={dialog} aria-label="Start a new project" oncancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
	<header><h2>Where are you starting?</h2><button type="button" onclick={onClose} disabled={busy} aria-label="Close new project">Close</button></header>
	<p>Your source story can describe a whole show. This project is the trailer, episode or film you want to make from it.</p>
	<div class="paths" role="group" aria-label="Starting point">
		<button type="button" class:chosen={path === 'need_idea'} aria-pressed={path === 'need_idea'} onclick={() => path = 'need_idea'}><b>I need an idea</b><span>Explore concepts and pitches.</span></button>
		<button type="button" class:chosen={path === 'have_idea'} aria-pressed={path === 'have_idea'} onclick={() => path = 'have_idea'}><b>I have an idea</b><span>Develop the idea into story beats.</span></button>
		<button type="button" class:chosen={path === 'have_story'} aria-pressed={path === 'have_story'} onclick={() => path = 'have_story'}><b>I already have a story</b><span>Import the Bible and plan this production.</span></button>
	</div>
	<form onsubmit={(event) => { event.preventDefault(); void create(); }}>
		<label>What are we making?<input bind:value={title} placeholder="Blood Rush · season trailer" required maxlength="200" /></label>
		{#if path === 'have_story'}
			<label>Import a connected Notion series<select bind:value={seriesId} onchange={() => root = ''}><option value="">Choose a series, paste a link, or paste text below</option>{#each series as show (show.series_id)}<option value={show.series_id}>{show.title}</option>{/each}</select></label>
			<label>Or connect a Notion series page<input bind:value={root} oninput={() => seriesId = ''} placeholder="https://www.notion.so/…" /></label>
			<p class="small">Import reads the current Bible and named references. It does not change Notion or import an episode’s full shot list into your trailer.</p>
		{/if}
		{#if path !== 'need_idea' && !seriesId && !root.trim()}<label>{path === 'have_story' ? 'Or paste your existing story / Bible' : 'Your starting idea'}<textarea bind:value={text} rows="6" required maxlength="100000"></textarea></label>{/if}
		{#if path !== 'need_idea'}<label>Existing reference images to offer in Prep (optional)<select bind:value={sourceId}><option value="">Start a new reference collection</option>{#each projects as project (project.project_id)}<option value={project.project_id}>{project.title}</option>{/each}</select></label>{/if}
		{#if error}<p role="alert" class="error">{error}</p>{/if}
		<footer><span>Bible → acts → scenes → story beats → shots → Prep and Board</span><button type="submit" class="primary" disabled={busy || !title.trim()}>{busy ? 'Importing and creating…' : path === 'need_idea' ? 'Start exploring' : 'Create project and review story beats'}</button></footer>
	</form>
</dialog>
</div>

<style>
	dialog.start {margin:auto;} dialog::backdrop {background:#050a10db;}
	.shade{position:fixed;inset:0;z-index:300;background:#050a10db;display:grid;place-items:center;padding:24px}.start{width:min(850px,100%);max-height:90vh;overflow:auto;background:#101a21;border:1px solid #36515a;color:#b9d1d4;padding:28px;font-size:13px}header,footer{display:flex;justify-content:space-between;align-items:center;gap:16px}h2{font-size:25px;color:#d7eeeb}p{line-height:1.7;color:#8da9b1;margin:14px 0}.paths{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0}.paths button{text-align:left;padding:16px}.paths span{display:block;margin-top:8px;font-size:11px;line-height:1.6;color:#87a5ac}.chosen{border-color:#66c4b4!important;background:#15372f!important}button{background:#13222a;border:1px solid #36515a;color:#b9d1d4;padding:9px 13px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{background:#225e4e;color:#ddfff0}label{display:block;margin:15px 0;font-size:12px}input,textarea,select{display:block;background:#0b141b;border:1px solid #36515a;color:#c9dfe1;padding:10px;width:100%;margin-top:6px;font-size:13px}.small,footer span{font-size:11px;color:#8da9b1}.error{color:#f5a7a3}footer{margin-top:24px}:is(button,input,select,textarea):focus-visible{outline:2px solid #7ed5c1;outline-offset:3px}@media(max-width:640px){.paths{grid-template-columns:1fr}header,footer{align-items:start;flex-direction:column}.shade{padding:10px}.start{padding:18px}}
</style>
