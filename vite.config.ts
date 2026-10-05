import tailwindcss from '@tailwindcss/vite';
import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The studio runs as a Node server on the operator's machine; Vercel hosts the public, read-only site.
			adapter: process.env.VERCEL ? vercelAdapter({ runtime: 'nodejs22.x' }) : nodeAdapter()
		})
	],
	// Agent worktrees and project data change underneath the dev server; never reload for them.
	server: { watch: { ignored: ['**/.claude/worktrees/**', '**/data/projects/**'] } }
});
