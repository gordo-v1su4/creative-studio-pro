import { describe, expect, it } from 'bun:test';
import { wakeCaptionGateway } from '../../src/lib/server/shot-tags';

const gateway = { url: 'https://caption.test/', token: 't' };

/** A fake gateway whose backend becomes healthy after `wakeAfter` health checks once started. */
function fakeGateway(options: { healthy?: boolean; wakeAfter?: number; startStatus?: number } = {}) {
	const calls: string[] = [];
	let started = false, checksSinceStart = 0;
	const fetchImpl = async (url: string, init?: RequestInit) => {
		calls.push(`${init?.method ?? 'GET'} ${url.replace('https://caption.test', '')}`);
		if (url.endsWith('/admin/qwen/start')) {
			started = true;
			return new Response(JSON.stringify({ detail: 'nope' }), { status: options.startStatus ?? 200 });
		}
		if (started) checksSinceStart++;
		const healthy = options.healthy || (started && checksSinceStart >= (options.wakeAfter ?? 1));
		return new Response(JSON.stringify({ qwenBackendHealthy: healthy }));
	};
	return { calls, fetchImpl };
}

describe('wakeCaptionGateway', () => {
	it('leaves a running backend alone', async () => {
		const fake = fakeGateway({ healthy: true });
		await wakeCaptionGateway(gateway, fake.fetchImpl, 1000, 1);
		expect(fake.calls).toEqual(['GET /health']);
	});

	it('starts a sleeping backend and waits until it is healthy', async () => {
		const fake = fakeGateway({ wakeAfter: 3 });
		await wakeCaptionGateway(gateway, fake.fetchImpl, 1000, 1);
		expect(fake.calls).toEqual(['GET /health', 'POST /admin/qwen/start', 'GET /health', 'GET /health', 'GET /health']);
	});

	it('says so when the gateway refuses to start it', async () => {
		const fake = fakeGateway({ startStatus: 503 });
		await expect(wakeCaptionGateway(gateway, fake.fetchImpl, 1000, 1)).rejects.toThrow('could not wake its model (503): nope');
	});

	it('gives up when the backend never gets healthy', async () => {
		const fake = fakeGateway({ wakeAfter: 1e9 });
		await expect(wakeCaptionGateway(gateway, fake.fetchImpl, 30, 5)).rejects.toThrow('did not wake within 0 s');
	});
});
