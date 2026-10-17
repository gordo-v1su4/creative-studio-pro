import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { SplitterManifest } from '$lib/domain/groups';

/**
 * Client for the operator's splitter service (splitter-pro2 at
 * splitter.serving.cloud): scene-detect a video into shots. Behind a PIN
 * gate: unlocking returns a session cookie that every job call carries.
 */
export interface Splitter {
	split(file: string, onProgress?: (stage: string) => void): Promise<{ manifest: SplitterManifest; download: (clipPath: string) => Promise<Uint8Array> }>;
	/** Grid stills (V1S-278): cut a rows × cols shot grid into its panels, in reading order. */
	splitGrid(file: string, rows: number, cols: number): Promise<{ panels: Array<{ index: number; label: string }>; download: (index: number) => Promise<Uint8Array> }>;
}

export function createSplitter(config: { url: string; pin: string | null; fetch?: typeof fetch; wait?: (ms: number) => Promise<void> }): Splitter {
	const base = config.url.replace(/\/+$/, '');
	const http = config.fetch ?? fetch;
	const wait = config.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));

	async function unlock(): Promise<string> {
		const status = (await (await http(`${base}/api/access-gate`)).json()) as { required?: boolean };
		if (!status.required) return '';
		if (!config.pin) throw new Error('The splitter needs its access PIN (SPLITTER_APP_ACCESS_PIN) on the server');
		const response = await http(`${base}/api/access-gate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: config.pin }) });
		if (!response.ok) throw new Error(`The splitter refused the access PIN (${response.status})`);
		const cookie = response.headers.get('set-cookie')?.split(';')[0];
		if (!cookie) throw new Error('The splitter unlocked but sent no session cookie');
		return cookie;
	}

	return {
		async splitGrid(file, rows, cols) {
			const cookie = await unlock();
			const headers = cookie ? { cookie } : undefined;
			const form = new FormData();
			form.append('file', new Blob([await readFile(file)], { type: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }), basename(file));
			form.append('rows', String(rows));
			form.append('cols', String(cols));
			const response = await http(`${base}/api/image-split/fixed-grid`, { method: 'POST', headers, body: form });
			if (!response.ok) throw new Error(`The splitter didn't split the grid (${response.status}: ${(await response.text()).slice(0, 200)})`);
			const { manifest } = (await response.json()) as { manifest: { split_id: string; panels: Array<{ index: number; label: string; asset_path: string }> } };
			const panels = manifest.panels.toSorted((a, b) => a.index - b.index);
			return {
				panels: panels.map(({ index, label }) => ({ index, label })),
				download: async (index) => {
					const panel = panels.find((entry) => entry.index === index);
					if (!panel) throw new Error(`The grid has no panel ${index}`);
					const got = await http(`${base}/api/image-split/${encodeURIComponent(manifest.split_id)}/panels/${panel.asset_path.split('/').map(encodeURIComponent).join('/')}`, { headers });
					if (!got.ok) throw new Error(`Downloading panel ${index} failed (${got.status})`);
					return new Uint8Array(await got.arrayBuffer());
				}
			};
		},
		async split(file, onProgress) {
			const cookie = await unlock();
			const headers = cookie ? { cookie } : undefined;
			const form = new FormData();
			form.append('file', new Blob([await readFile(file)], { type: 'video/mp4' }), basename(file));
			form.append('split_mode', 'scenes');
			const created = await http(`${base}/api/jobs`, { method: 'POST', headers, body: form });
			if (!created.ok) throw new Error(`The splitter didn't take the video (${created.status}: ${(await created.text()).slice(0, 200)})`);
			const jobId = ((await created.json()) as { job: { job_id: string } }).job.job_id;
			for (let i = 0; i < 300; i++) {
				const state = (await (await http(`${base}/api/jobs/${jobId}`, { headers })).json()) as { status: string; stage?: string; error?: string | null };
				if (state.status === 'completed') break;
				if (state.status === 'failed') throw new Error(`The splitter failed: ${state.error ?? state.stage ?? 'unknown error'}`);
				onProgress?.(state.stage ?? state.status);
				if (i === 299) throw new Error('The splitter took too long');
				await wait(2000);
			}
			const result = (await (await http(`${base}/api/jobs/${jobId}/result`, { headers })).json()) as { manifest: SplitterManifest };
			return {
				manifest: result.manifest,
				download: async (clipPath) => {
					const response = await http(`${base}/api/jobs/${jobId}/assets/${clipPath.split('/').map(encodeURIComponent).join('/')}`, { headers });
					if (!response.ok) throw new Error(`Downloading ${clipPath} failed (${response.status})`);
					return new Uint8Array(await response.arrayBuffer());
				}
			};
		}
	};
}
