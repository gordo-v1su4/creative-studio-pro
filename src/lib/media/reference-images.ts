export type ReferenceImageSize = 'small' | 'medium' | 'large';

/** Compact views request a derivative; zoom and generation keep the original URL. */
export function referenceImageUrl(source: string, size: ReferenceImageSize = 'medium'): string {
	if (!/^\/api\/(?:projects\/[^/]+\/files\/|series\/[^/]+\/references\?)/.test(source)) return source;
	const url = new URL(source, 'http://studio.local');
	url.searchParams.set('variant', size);
	return url.pathname + url.search;
}
