import { env } from '$env/dynamic/private';

/** The public, read-only deployment (on Vercel, or with CSP_PUBLIC_SITE=1). The studio on the operator's machine is never public. */
export const isPublicSite = () => env.CSP_PUBLIC_SITE === '1' || Boolean(process.env.VERCEL);
