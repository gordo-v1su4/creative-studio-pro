import type { PageServerLoad } from './$types';
import { getPublishedReader } from '$lib/server/published-store';

export const load: PageServerLoad = async () => {
	const reader = getPublishedReader();
	const entries = await reader.index();
	return { entries: entries.map((entry) => ({ ...entry, poster: entry.poster ? reader.mediaUrl(entry.slug, entry.poster) : null })) };
};
