import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { isPublicSite } from '$lib/server/public-site';

/**
 * Whether this is the public, read-only site (no way into the studio) or the operator's studio, and, in the
 * studio, where Review Room is, so a shot can link to itself there (the address only; never its key).
 */
export const load: LayoutServerLoad = () => {
	const publicSite = isPublicSite();
	return { publicSite, reviewRoomUrl: publicSite ? null : (env.CSP_REVIEW_ROOM_URL?.trim() || null) };
};
