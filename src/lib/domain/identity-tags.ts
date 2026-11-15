import { z } from 'zod';
const reference = z.object({ key: z.string().min(1).max(300), name: z.string().min(1).max(200) });
/** Declared reference identities, not an unverified face-recognition result. */
export const identityTagsSchema = z.object({ characters: z.array(reference).max(40).default([]), location: reference.optional() });
