import type { LayoutServerLoad } from './$types';
import { isPublicSite } from '$lib/server/public-site';

/** Whether this is the public, read-only site (no way into the studio) or the operator's studio. */
export const load: LayoutServerLoad = () => ({ publicSite: isPublicSite() });
