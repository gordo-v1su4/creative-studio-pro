import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { modelChoiceSchema, modelTestResultSchema } from '$lib/domain/model-provider';
import type { PublicAppSettings } from '$lib/domain/model-provider';

/**
 * App settings (V1S-117): one server-side JSON file outside every project
 * folder. It is the only place provider keys are stored; keys never enter a
 * project, its ledger, or a response to the browser.
 */

const key = z.string().trim().max(4000).nullable().default(null);

export const appSettingsSchema = z.object({
	schema_version: z.literal(1).default(1),
	hyper: z.object({ api_key: key }).default({ api_key: null }),
	custom: z.object({ base_url: z.string().trim().max(500).nullable().default(null), api_key: key }).default({ base_url: null, api_key: null }),
	/** App-wide default Agent model; null = legacy KIMI_* env fallback. */
	default_model: modelChoiceSchema.nullable().default(null),
	/** Last pick-time test per provider|endpoint|model. */
	model_tests: z.record(z.string(), modelTestResultSchema).default({})
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const emptyAppSettings = (): AppSettings => appSettingsSchema.parse({});

/** Browser-safe view: key presence only. */
export function publicAppSettings(settings: AppSettings): PublicAppSettings {
	return {
		hyper: { has_key: Boolean(settings.hyper.api_key) },
		custom: { base_url: settings.custom.base_url, has_key: Boolean(settings.custom.api_key) },
		default_model: settings.default_model,
		model_tests: settings.model_tests
	};
}

/**
 * Default location: next to the project root, never inside it — with
 * CSP_PROJECT_ROOT=data/projects the file is data/app-settings.json.
 */
export function appSettingsPath(projectRoot: string, override?: string | null): string {
	const path = override?.trim() ? resolve(override.trim()) : join(dirname(resolve(projectRoot)), 'app-settings.json');
	const root = resolve(projectRoot);
	const inside = relative(root, path);
	if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
		throw new Error('CSP_APP_SETTINGS_PATH must be outside CSP_PROJECT_ROOT; keys never live with projects');
	}
	return path;
}

export class AppSettingsStore {
	private queue: Promise<unknown> = Promise.resolve();

	constructor(readonly path: string) {}

	async read(): Promise<AppSettings> {
		let content: string;
		try { content = await readFile(this.path, 'utf8'); }
		catch (cause) {
			if ((cause as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyAppSettings();
			throw cause;
		}
		return appSettingsSchema.parse(JSON.parse(content));
	}

	/** Serialized read-modify-write; atomic replace; owner-only file mode where supported. */
	update(mutate: (current: AppSettings) => AppSettings): Promise<AppSettings> {
		const run = this.queue.then(async () => {
			const next = appSettingsSchema.parse(mutate(await this.read()));
			await mkdir(dirname(this.path), { recursive: true });
			const temp = `${this.path}.${process.pid}.tmp`;
			await writeFile(temp, JSON.stringify(next, null, '\t') + '\n', { encoding: 'utf8', mode: 0o600 });
			await rename(temp, this.path);
			return next;
		});
		this.queue = run.catch(() => undefined);
		return run;
	}
}
