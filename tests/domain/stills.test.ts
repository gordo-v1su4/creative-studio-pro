import { describe, expect, test } from 'bun:test';
import { approvalProblems, episodeSpend, stillApproval } from '../../src/lib/domain/stills';
import { jobIdOf, stillArgs, STILL_MODEL } from '../../src/lib/server/higgsfield';

const base = { prompt: 'Kai from image 1 on the roof.', attached: [{ name: 'Kai "Hoodie" Santana', file: 'C:/refs/kai.png', url: '/r/kai' }, { name: 'Video Haven', file: 'C:/refs/vh.png' }], model: 'GPT Image 2.5', resolution: '2K', aspect_ratio: '16:9', credits: 2.75, spent: 10, blocked: [] };

describe('the still approval step (V1S-373)', () => {
	test('lists the references in attach order with their exact names, and the running total', () => {
		const approval = stillApproval(base);
		expect(approval.references.map((ref) => [ref.order, ref.name])).toEqual([[1, 'Kai "Hoodie" Santana'], [2, 'Video Haven']]);
		expect([approval.episode_spent, approval.episode_after]).toEqual([10, 12.75]);
		expect(approval.references[0].url).toBe('/r/kai');
	});

	test('a send is refused when the prompt, the order or the price changed since approval', () => {
		const approved = stillApproval(base);
		const ok = { approval_key: approved.approval_key, confirmed_credits: 2.75 };
		expect(approvalProblems(stillApproval(base), ok)).toEqual([]);
		expect(approvalProblems(stillApproval({ ...base, prompt: 'Kai from image 1 in the store.' }), ok).join(' ')).toContain('changed since you approved');
		expect(approvalProblems(stillApproval({ ...base, attached: [...base.attached].reverse() }), ok).join(' ')).toContain('changed since you approved');
		expect(approvalProblems(stillApproval({ ...base, credits: 5.5 }), ok).join(' ')).toContain('above the 2.75');
		expect(stillApproval({ ...base, credits: null }).blocked).toEqual(['The price check failed']);
	});

	test('the episode total counts renders and stills', () => {
		expect(episodeSpend({ generations: [{ estimate_credits: 15 } as never], still_sends: [{ credits: 2.75 } as never, { credits: 2.75 } as never] })).toBe(20.5);
		expect(episodeSpend({})).toBe(0);
	});

	test('a job id comes back whatever shape the CLI prints (GPT Image 2.5 prints a plain list of ids)', () => {
		expect(jobIdOf(['1dd55c04-3b6a-4013-bb58-3e6c27c02b13'])).toBe('1dd55c04-3b6a-4013-bb58-3e6c27c02b13');
		expect(jobIdOf({ id: 'a' })).toBe('a');
		expect(jobIdOf({ jobs: [{ job_id: 'b' }] })).toBe('b');
		expect(jobIdOf([])).toBeNull();
	});

	test('stills go to GPT Image 2.5 at 2K, high quality, references in order', () => {
		expect(STILL_MODEL).toMatchObject({ job_type: 'gpt_image_2_5', variant: 'sunburst', quality: 'high', resolution: '2k' });
		expect(stillArgs({ prompt: 'x', references: ['a.png', 'b.png'], aspect_ratio: '16:9' }, 'p.json')).toEqual([
			'gpt_image_2_5', '--prompt', '@p.json', '--aspect_ratio', '16:9', '--variant', 'sunburst', '--quality', 'high', '--resolution', '2k', '--image-references', 'a.png', '--image-references', 'b.png'
		]);
	});
	test('Nano Banana Pro uses its own flags without GPT quality or variant', () => {
		expect(stillArgs({ prompt: 'x', references: ['a.png'], aspect_ratio: '16:9', model: 'nano_banana_pro' }, 'p.json')).toEqual([
			'nano_banana_pro', '--prompt', '@p.json', '--aspect_ratio', '16:9', '--resolution', '2k', '--image-references', 'a.png'
		]);
	});
});
