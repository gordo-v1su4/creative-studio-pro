import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPublishedReader } from '$lib/server/published-store';

export const load: PageServerLoad = async ({ params }) => {
	const reader = getPublishedReader();
	const snapshot = await reader.snapshot(params.slug);
	if (!snapshot) error(404, 'Not published');
	// Resolve every media path to the URL the browser loads it from (the bucket, or the local preview route).
	const urls = Object.fromEntries(snapshot.files.map((file) => [file, reader.mediaUrl(snapshot.slug, file)]));
	return { snapshot, urls };
};
