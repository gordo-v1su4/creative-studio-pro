<script lang="ts">
	/**
	 * The project menu: everything that used to sit beside the stages in the top bar
	 * (new project, publish, the app's other pages, the references drawer, status).
	 */
	type MenuLink = { label: string; href: string; hint: string };
	let {
		open = $bindable(false),
		links,
		version = null,
		hasProject = false,
		creating = false,
		refsOpen = false,
		onNew,
		onPublish,
		onRefs,
		onStatus
	}: {
		open?: boolean;
		links: MenuLink[];
		version?: number | null;
		hasProject?: boolean;
		creating?: boolean;
		refsOpen?: boolean;
		onNew: () => void;
		onPublish: () => void;
		onRefs: () => void;
		onStatus: () => void;
	} = $props();

	function run(action: () => void) {
		open = false;
		action();
	}
</script>

{#if open}
	<button type="button" class="shade" aria-label="Close the menu" onclick={() => (open = false)}></button>
	<div class="menu" role="menu" aria-label="Project menu">
		<button type="button" role="menuitem" onclick={() => run(onNew)} disabled={creating}><span>{creating ? 'Creating…' : 'New project'}</span></button>
		<button type="button" role="menuitem" onclick={() => run(onPublish)} disabled={!hasProject} title="Publish this project to the public watch pages (read-only)"><span>Publish…</span></button>
		<button type="button" role="menuitem" onclick={() => run(onRefs)} title="Character headshots, places, seed and voices"><span>References drawer</span><small>{refsOpen ? 'open' : ''}</small></button>
		<p class="cp">App</p>
		{#each links as link (link.href)}
			<a role="menuitem" href={link.href} title={link.hint} onclick={() => (open = false)}><span>{link.label}</span></a>
		{/each}
		<button type="button" role="menuitem" onclick={() => run(onStatus)} title="Which machines and services are reachable"><span>Status</span></button>
		{#if version !== null}<p class="cp">Project version {version}</p>{/if}
	</div>
{/if}

<style>
	.shade { position: fixed; inset: 0; z-index: 44; border: 0; background: transparent; cursor: default; }
	.menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 45; display: flex; width: 200px; flex-direction: column; gap: 1px; border-radius: 8px; background: var(--color-raised); padding: 5px; box-shadow: 0 16px 40px rgb(0 0 0 / 0.6); }
	.menu button, .menu a { display: flex; height: 24px; align-items: center; gap: 8px; border: 0; border-radius: 5px; background: none; padding: 0 8px; color: var(--color-ink-2); font: 12.5px var(--font-sans); text-align: left; white-space: nowrap; cursor: pointer; }
	.menu button:hover:not(:disabled), .menu a:hover, .menu button:focus-visible, .menu a:focus-visible { background: var(--color-selected); color: var(--color-teal-ink); outline: none; }
	.menu button:disabled { opacity: 0.4; cursor: default; }
	.menu small { margin-left: auto; color: var(--color-teal); font: 9.5px var(--font-mono); letter-spacing: 0.11em; text-transform: uppercase; }
	.menu p { margin: 0; padding: 8px 8px 3px; color: var(--color-ink-3); }
</style>
