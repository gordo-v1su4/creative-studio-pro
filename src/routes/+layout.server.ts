import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { isPublicSite } from '$lib/server/public-site';
import { getNotionView } from '$lib/server/config';

/**
 * Whether this is the public, read-only site (no way into the studio) or the operator's studio, and, in the
 * studio, where Review Room is, so a shot can link to itself there (the address only; never its key), and
 * what the front door needs to know about Notion.
 */
export const load: LayoutServerLoad = async () => {
	const publicSite = isPublicSite();
	// Notion, for the front door: whether a key is set (never the key) and the public template's address.
	const notion = publicSite ? null : await getNotionView().catch(() => null);
	return { publicSite, reviewRoomUrl: publicSite ? null : (env.CSP_REVIEW_ROOM_URL?.trim() || null), notionReady: notion?.has_key ?? false, notionTemplateUrl: notion?.template_url ?? null };
};
