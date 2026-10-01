import { describe, expect, test } from 'bun:test';
import {
	applyProjectModelChoice,
	applyProjectModelLock,
	emptyProjectAgentModel,
	gradeModelTest,
	parseModelList,
	visionModelsOnly
} from '../../src/lib/domain/model-provider';
import type { ModelChoice } from '../../src/lib/domain/model-provider';

const hyper = (model: string): ModelChoice => ({ provider: 'hyper', model, base_url: 'https://hyper.charm.land/v1' });

describe('Model provider vision capability', () => {
	test('metadata decides when present; the allowlist only fills gaps', () => {
		const models = parseModelList({ data: [
			{ id: 'acme/text-only', architecture: { input_modalities: ['text'] } },
			{ id: 'acme/seer', architecture: { input_modalities: ['text', 'image'] } },
			{ id: 'acme/caps', capabilities: { vision: true } },
			{ id: 'acme/modal', modalities: { input: ['text'] } },
			{ id: 'deepseek-v4.1-flash' },
			{ id: 'glm-5.3-flash', name: 'GLM 5.3 Flash' },
			{ id: 'mystery-model' },
			{ id: 'glm-5.3-flash' }
		] });
		const byId = Object.fromEntries(models.map((model) => [model.id, model]));
		expect(models).toHaveLength(7);
		expect(byId['acme/text-only']).toMatchObject({ vision: false, vision_source: 'metadata' });
		expect(byId['acme/seer']).toMatchObject({ vision: true, vision_source: 'metadata' });
		expect(byId['acme/caps']?.vision).toBeTrue();
		expect(byId['acme/modal']?.vision).toBeFalse();
		expect(byId['deepseek-v4.1-flash']).toMatchObject({ vision: true, vision_source: 'allowlist' });
		expect(byId['mystery-model']?.vision).toBeFalse();
	});

	test('a known-vision name loses to metadata that says text only', () => {
		const [model] = parseModelList([{ id: 'deepseek-v4.1-flash', input_modalities: ['text'] }]);
		expect(model?.vision).toBeFalse();
	});

	test('offers vision models only, DeepSeek V4.1 Flash first then GLM 5.3 Flash', () => {
		const offered = visionModelsOnly(parseModelList({ models: [{ id: 'zeta', supports_vision: true }, { id: 'glm-5.3-flash' }, { id: 'plain' }, { id: 'deepseek/deepseek-v4.1-flash' }] }));
		expect(offered.map((model) => model.id)).toEqual(['deepseek/deepseek-v4.1-flash', 'glm-5.3-flash', 'zeta']);
	});

	test('rejects a body with no model list', () => {
		expect(() => parseModelList({ error: 'nope' })).toThrow('no model list');
	});
});

describe('Model test grading', () => {
	test('passes only with image read, exact shape and rules', () => {
		expect(gradeModelTest({ color: 'red', word_count: 3, echo: 'narrate-check' }, 120, 'now').passed).toBeTrue();
		const blind = gradeModelTest({ color: 'unknown', word_count: 3, echo: 'narrate-check' }, 10, 'now');
		expect(blind.passed).toBeFalse();
		expect(blind.checks).toEqual({ image: false, structured: true, rules: true });
		const sloppy = gradeModelTest({ color: 'Red', word_count: '3', echo: 'narrate-check' }, 10, 'now');
		expect(sloppy.checks.rules).toBeFalse();
		expect(gradeModelTest(null, 10, 'now').checks.structured).toBeFalse();
		expect(gradeModelTest({ color: 'red', word_count: 3, echo: 'narrate-check', extra: true }, 10, 'now').checks.structured).toBeFalse();
	});
});

describe('Project model lock rules', () => {
	test('override is free before the first run; the lock pins the model that ran', () => {
		const set = applyProjectModelChoice(emptyProjectAgentModel(), { choice: hyper('glm-5.3-flash'), operator: 'gordo', reason: null, confirm_switch: false, now: 't1' });
		expect(set.event).toBe('override_set');
		expect(() => applyProjectModelLock(set.state, { choice: hyper('deepseek-v4.1-flash'), operator: 'gordo', now: 't2' })).toThrow('override is');
		const locked = applyProjectModelLock(set.state, { choice: hyper('glm-5.3-flash'), operator: 'gordo', now: 't2' });
		expect(locked.changed).toBeTrue();
		expect(locked.state.locked_at).toBe('t2');
		expect(applyProjectModelLock(locked.state, { choice: hyper('glm-5.3-flash'), operator: 'gordo', now: 't3' }).changed).toBeFalse();
	});

	test('after the lock, switching needs an explicit confirmation and a reason', () => {
		const locked = applyProjectModelLock(emptyProjectAgentModel(), { choice: hyper('glm-5.3-flash'), operator: 'gordo', now: 't1' }).state;
		const next = hyper('deepseek-v4.1-flash');
		expect(() => applyProjectModelChoice(locked, { choice: next, operator: 'gordo', reason: 'better', confirm_switch: false, now: 't2' })).toThrow('confirmed');
		expect(() => applyProjectModelChoice(locked, { choice: next, operator: 'gordo', reason: null, confirm_switch: true, now: 't2' })).toThrow('reason');
		expect(() => applyProjectModelChoice(locked, { choice: null, operator: 'gordo', reason: 'back', confirm_switch: true, now: 't2' })).toThrow('specific model');
		const switched = applyProjectModelChoice(locked, { choice: next, operator: 'gordo', reason: 'Cheaper vision', confirm_switch: true, now: 't2' });
		expect(switched.event).toBe('switched');
		expect(switched.state.history.at(-1)).toMatchObject({ event: 'switched', from: hyper('glm-5.3-flash'), to: next, reason: 'Cheaper vision' });
	});
});
