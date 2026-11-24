/**
 * Stills in a cut (CONTEXT.md: Hold). A picture has no length of its own: it is one frame,
 * held for as long as the cut entry says.
 */

const STILL = /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;

/** True when a take's file is a picture rather than a video. */
export const isStillUrl = (url: string) => STILL.test(url);

/** The length a still reports: longer than any hold a cut will ask for, so the entry's own out-point decides. */
export const STILL_SECONDS = 3600;

/** The frame rate a still is stepped at in the player, so frame keys move it a sensible amount. */
export const STILL_FPS = 24;
