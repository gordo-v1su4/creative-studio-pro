import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { ResidentCapacityError, ResidentFrameBank, ResidentMemoryBudget, type BankProgress } from './ResidentFrameBank';
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

const blobs = new Map<string, Promise<Blob>>();
const banks = new Map<string, BankEntry>();
const posters = new Map<string, Promise<Poster>>();
let budget: ResidentMemoryBudget | null = null;

onSharedWebGpuDeviceLost(() => {
	// Everything below was built on the lost device.
	banks.clear();
	posters.clear();
	budget = null;
	pipelines = new WeakMap();
});

function blobFor(url: string): Promise<Blob> {
	let blob = blobs.get(url);
	if (!blob) {
		blob = fetch(url).then((response) => {
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
		if (entry[0] !== except && entry[1].bank?.stats.ready && (!oldest || entry[1].usedAt < oldest[1].usedAt)) oldest = entry;
	}
	if (!oldest) return false;
	oldest[1].bank?.dispose();
	banks.delete(oldest[0]);
	return true;
}

/** Decode a whole clip into GPU textures (once per url and size). */
export function loadBank(url: string, maxHeight: number, progress: (p: BankProgress) => void = () => {}): Promise<ResidentFrameBank> {
	const key = `${url}@${maxHeight}`;
	const hit = banks.get(key);
	if (hit) {
		hit.usedAt = performance.now();
		return hit.ready;
	}
	const entry: BankEntry = { bank: null, usedAt: performance.now(), ready: Promise.resolve(null as never) };
	entry.ready = (async () => {
		const device = await requireDevice();
		budget ??= new ResidentMemoryBudget(BUDGET_BYTES);
		const blob = await blobFor(url);
		for (;;) {
			const bank = new ResidentFrameBank(device, budget);
			entry.bank = bank;
			try {
				await bank.load(blob, progress, maxHeight);
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

/** One decoded frame at a fraction of the clip, shown before the bank is resident. */
export function loadPoster(url: string, at = 0.3): Promise<Poster> {
	let poster = posters.get(url);
	if (!poster) {
		poster = (async () => {
			const device = await requireDevice();
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await blobFor(url)) });
			try {
				const track = await input.getPrimaryVideoTrack();
				if (!track) throw new Error('The clip has no video track');
				const duration = await track.computeDuration();
				const sample = await new VideoSampleSink(track).getSample(duration * at);
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
		poster.catch(() => posters.delete(url));
		posters.set(url, poster);
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
