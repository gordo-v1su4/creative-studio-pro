/** A shared wall clock for countdowns (finalize badges, the banner), ticking once a minute while anything reads it. */
class Clock {
	now = $state(Date.now());
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor() {
		if (typeof window !== 'undefined') this.#timer = setInterval(() => (this.now = Date.now()), 60_000);
	}
}

export const clock = new Clock();
