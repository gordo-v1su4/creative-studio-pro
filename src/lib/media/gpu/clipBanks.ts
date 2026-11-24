import { ALL_FORMATS, BlobSource, Input, UrlSource, VideoSampleSink } from 'mediabunny';
import { ResidentCapacityError, ResidentFrameBank, ResidentMemoryBudget, residentDimensions, type BankProgress } from './ResidentFrameBank';
import { isStillUrl, STILL_FPS, STILL_SECONDS } from '$lib/media/stills';
import { getPreferredCanvasFormat, getSharedWebGpuDevice, onSharedWebGpuDeviceLost } from './SharedGpuDevice';

/**
 * Review-grade clip playback: every clip a reviewer hovers is decoded once into a
 * resident GPU frame bank (beatsmaxxer's model), so scrubbing to any timestamp is a
 * texture lookup, not a seek. Banks are shared across every card showing the same
 * clip and evicted least-recently-used when the GPU budget runs out.
 */
const BUDGET_BYTES = 1.5 * 2 ** 30;

interface BankEntry { ready: Promise<ResidentFrameBank>; bank: ResidentFrameBank | null; usedAt: number }
export interface Poster { texture: GPUTexture; view: GPUTextureView; duration: number }

/**
 * Project video files are previewed from the server's 480p editing proxy (`?proxy=1`) and shown at rest as a
 * small server-made still (`?poster=1`); Export and Review Room use the originals. Other URLs load as given.
 */
const PROJECT_VIDEO = /^(?:https?:\/\/[^/]+)?\/api\/projects\/[^/]+\/files\/[^?#]+\.(?:mp4|mov|webm)(?:[?#]|$)/i;
const withParam = (url: string, param: string) => (PROJECT_VIDEO.test(url) ? `${url}${url.includes('?') ? '&' : '?'}${param}=1` : url);
export const proxyUrl = (url: string) => withParam(url, 'proxy');
/** The server still at `at` seconds (default the first frame), or null for a URL that isn't a project video. */
export const posterUrl = (url: string, at = 0) => (PROJECT_VIDEO.test(url) ? `${withParam(url, 'poster')}${at > 0 ? `&t=${Math.round(at * 100) / 100}` : ''}` : null);

/** The take's frame strip (see $lib/media/strips), or null for a URL that isn't a project video. */
export const stripUrl = (url: string) => (PROJECT_VIDEO.test(url) ? withParam(url, 'strip') : null);

const blobs = new Map<string, Promise<Blob>>();
const clipMetadata = new Map<string, Promise<{ duration: number; fps: number; hasAudio: boolean }>>();
const banks = new Map<string, BankEntry>();
const posters = new Map<string, Promise<Poster>>();
/** Keys pinned while on screen — never chosen by {@link evictOldest}. */
const pinned = new Set<string>();
let budget: ResidentMemoryBudget | null = null;

function bankKey(url: string, maxHeight: number): string {
	return `${url}@${maxHeight}`;
}

export function getResidentBudget(): { limit: number; used: number; available: number } | null {
	if (!budget) return null;
	return { limit: budget.limit, used: budget.used, available: budget.available };
}

/** Keep this clip resident while it is playing; eviction skips pinned banks. */
export function pinBank(url: string, maxHeight: number): void {
	pinned.add(bankKey(url, maxHeight));
	const hit = banks.get(bankKey(url, maxHeight));
	if (hit) hit.usedAt = performance.now();
}

export function unpinBank(url: string, maxHeight: number): void {
	pinned.delete(bankKey(url, maxHeight));
}

/** Read timeline bounds without decoding or uploading frames. */
export function loadClipMetadata(url: string): Promise<{ duration: number; fps: number; hasAudio: boolean }> {
	let pending = clipMetadata.get(url);
	// A still in a cut: nothing to read, it is one frame held for as long as the cut says.
	if (!pending && isStillUrl(url)) {
		pending = Promise.resolve({ duration: STILL_SECONDS, fps: STILL_FPS, hasAudio: false });
		clipMetadata.set(url, pending);
	}
	if (!pending) {
		pending = (async () => {
			const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(new URL(proxyUrl(url), location.href)) });
			try {
				const [track, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
				if (!track) throw new Error('The clip has no video track');
				const [duration, packets] = await Promise.all([track.computeDuration(), track.computePacketStats(120)]);
				if (!Number.isFinite(duration) || duration <= 0) throw new Error('The clip has no finite duration');
				return { duration, fps: packets.averagePacketRate, hasAudio: !!audio };
			} finally {
				input.dispose();
			}
		})();
		pending.catch(() => clipMetadata.delete(url));
		clipMetadata.set(url, pending);
	}
	return pending;
}

/** Bytes a decoded bank would need, from container metadata (no GPU upload). */
export async function estimateBankBytes(url: string, maxHeight: number): Promise<number> {
	const blob = await loadClipBlob(url);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return 0;
		const [width, height, packets] = await Promise.all([
			track.getDisplayWidth(), track.getDisplayHeight(), track.computePacketStats()
		]);
		const size = residentDimensions(width, height, maxHeight);
		return size.width * size.height * 4 * packets.packetCount;
	} finally {
		input.dispose();
	}
}

onSharedWebGpuDeviceLost(() => {
	// Everything below was built on the lost device.
	banks.clear();
	posters.clear();
	budget = null;
	pipelines = new WeakMap();
});

/** Share compressed media between the frame bank and seekable local media elements. */
export function loadClipBlob(url: string): Promise<Blob> {
	let blob = blobs.get(url);
	if (!blob) {
		blob = fetch(proxyUrl(url)).then((response) => {
			if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
			return response.blob();
		});
		blob.catch(() => blobs.delete(url));
		blobs.set(url, blob);
	}
	return blob;
}

async function requireDevice(): Promise<GPUDevice> {
	const device = await getSharedWebGpuDevice();
	if (!device) throw new Error('WebGPU is not available in this browser');
	return device;
}

function evictOldest(except: string): boolean {
	let oldest: [string, BankEntry] | null = null;
	for (const entry of banks) {
		if (entry[0] === except || pinned.has(entry[0]) || !entry[1].bank?.stats.ready) continue;
		if (!oldest || entry[1].usedAt < oldest[1].usedAt) oldest = entry;
	}
	if (!oldest) return false;
	oldest[1].bank?.dispose();
	banks.delete(oldest[0]);
	return true;
}

/** Decode a whole clip into GPU textures (once per url and size). */
export function loadBank(url: string, maxHeight: number, progress: (p: BankProgress) => void = () => {}): Promise<ResidentFrameBank> {
	const key = bankKey(url, maxHeight);
	const hit = banks.get(key);
	if (hit) {
		hit.usedAt = performance.now();
		return hit.ready;
	}
	const entry: BankEntry = { bank: null, usedAt: performance.now(), ready: Promise.resolve(null as never) };
	entry.ready = (async () => {
		const device = await requireDevice();
		budget ??= new ResidentMemoryBudget(BUDGET_BYTES);
		const blob = await loadClipBlob(url);
		for (;;) {
			const bank = new ResidentFrameBank(device, budget);
			entry.bank = bank;
			try {
				if (isStillUrl(url)) {
					const image = await createImageBitmap(blob);
					try { await bank.loadStill(image, STILL_SECONDS, STILL_FPS, maxHeight); }
					finally { image.close(); }
					progress({ frames: 1, total: 1, bytes: bank.stats.bytes });
				} else {
					await bank.load(blob, progress, maxHeight);
				}
				return bank;
			} catch (error) {
				if (!(error instanceof ResidentCapacityError) || !evictOldest(key)) throw error;
			}
		}
	})();
	entry.ready.catch(() => banks.delete(key));
	banks.set(key, entry);
	return entry.ready;
}

/** The frame at `at` seconds (the clip's in-point: where hover playback starts), shown before the bank is resident. */
export function loadPoster(url: string, at = 0): Promise<Poster> {
	const key = `${url}#${Math.round(at * 100) / 100}`;
	let poster = posters.get(key);
	if (!poster) {
		poster = (async () => {
			const device = await requireDevice();
			// A project video: the server's small still, no clip download. Falls back to decoding a frame.
			const still = posterUrl(url, at);
			if (still) {
				try {
					const response = await fetch(still);
					if (!response.ok) throw new Error(`poster ${response.status}`);
					const image = await createImageBitmap(await response.blob());
					try {
						const size: [number, number] = [image.width, image.height];
						const texture = device.createTexture({ size, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
						device.queue.copyExternalImageToTexture({ source: image }, { texture }, size);
						return { texture, view: texture.createView(), duration: 0 };
					} finally { image.close(); }
				} catch { /* decode a frame below */ }
			}
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await loadClipBlob(url)) });
			try {
				const track = await input.getPrimaryVideoTrack();
				if (!track) throw new Error('The clip has no video track');
				const duration = await track.computeDuration();
				const sample = await new VideoSampleSink(track).getSample(Math.min(at, Math.max(0, duration - 0.05)));
				if (!sample) throw new Error('No frame at the poster time');
				const frame = sample.toVideoFrame();
				try {
					const size: [number, number] = [frame.displayWidth, frame.displayHeight];
					const texture = device.createTexture({ size, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
					device.queue.copyExternalImageToTexture({ source: frame }, { texture }, size);
					return { texture, view: texture.createView(), duration };
				} finally {
					frame.close();
					sample.close();
				}
			} finally {
				input.dispose();
			}
		})();
		poster.catch(() => posters.delete(key));
		posters.set(key, poster);
	}
	return poster;
}

const SHADER = /* wgsl */ `
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
	var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	var o: Out;
	o.pos = vec4f(p[i], 0.0, 1.0);
	o.uv = vec2f((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
	return o;
}
@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@fragment fn fs(in: Out) -> @location(0) vec4f { return textureSample(frameTexture, frameSampler, in.uv); }
`;

let pipelines = new WeakMap<GPUDevice, { pipeline: GPURenderPipeline; sampler: GPUSampler }>();

function blitFor(device: GPUDevice) {
	let blit = pipelines.get(device);
	if (!blit) {
		const module = device.createShaderModule({ code: SHADER });
		blit = {
			pipeline: device.createRenderPipeline({
				layout: 'auto',
				vertex: { module, entryPoint: 'vs' },
				fragment: { module, entryPoint: 'fs', targets: [{ format: getPreferredCanvasFormat() }] }
			}),
			sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
		};
		pipelines.set(device, blit);
	}
	return blit;
}

/** Bind a canvas to the shared device; returns a draw(view) for that canvas. */
export async function attachCanvas(canvas: HTMLCanvasElement): Promise<(view: GPUTextureView) => void> {
	const tiles = await attachTiles(canvas);
	return (view) => tiles([view]);
}

/**
 * Bind a canvas that draws a row of frames side by side (a filmstrip); one view fills
 * the canvas. Each call clears and redraws the whole row.
 */
export async function attachTiles(canvas: HTMLCanvasElement): Promise<(views: GPUTextureView[]) => void> {
	const device = await requireDevice();
	const context = canvas.getContext('webgpu');
	if (!context) throw new Error('This canvas cannot use WebGPU');
	context.configure({ device, format: getPreferredCanvasFormat(), alphaMode: 'opaque' });
	return (views) => {
		if (!views.length || canvas.width < 2) return;
		const { pipeline, sampler } = blitFor(device);
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }]
		});
		pass.setPipeline(pipeline);
		const tile = canvas.width / views.length;
		views.forEach((view, i) => {
			pass.setViewport(i * tile, 0, tile, canvas.height, 0, 1);
			pass.setBindGroup(0, device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: view }]
			}));
			pass.draw(3);
		});
		pass.end();
		device.queue.submit([encoder.finish()]);
	};
}
