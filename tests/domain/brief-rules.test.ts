import { describe, expect, test } from 'bun:test';
import { bannedTerms, writeBriefSection } from '../../src/lib/domain/brief-rules';
import { lintPrompt } from '../../src/lib/domain/prompt-lint';

describe('the brief in the rules file', () => {
	const existing = '# Blood Rush prompt rules\n\n| Do | Don\'t |\n| --- | --- |\n| Full colour | Black and white |\n';

	test('the brief section is added once, then rewritten in place; the rest of the file is kept', () => {
		const once = writeBriefSection(existing, { tone: 'Wet night streets, sodium light.', mustNots: ['Never write "glitter".', 'No letterbox'] });
		expect(once.startsWith(existing.trimEnd())).toBeTrue();
		expect(once).toContain('### Must not\n\n- Never write "glitter".\n- No letterbox\n');
		const twice = writeBriefSection(once, { tone: 'Golden hour.', mustNots: ['No “lens flare” at all'] });
		expect(twice.match(/narrate:brief -->/g)).toHaveLength(2);
		expect(twice).toContain('Golden hour.');
		expect(twice).not.toContain('sodium');
		expect(twice).toContain('| Full colour | Black and white |');
	});

	test('a new rules file gets a heading', () => {
		expect(writeBriefSection('', { tone: 't', mustNots: [] }).startsWith('# Project prompt rules')).toBeTrue();
	});

	test('quoted words in the must-nots become banned terms; other quotes in the file do not', () => {
		const rules = writeBriefSection('Say "hero shot" a lot.\n', { tone: 'Avoid "moody".', mustNots: ['Never write "glitter".', 'No “lens flare”', 'No letterbox'] });
		expect(bannedTerms(rules)).toEqual(['glitter', 'lens flare']);
		expect(bannedTerms(null)).toEqual([]);
		expect(bannedTerms('no section here "glitter"')).toEqual([]);
	});

	test('the linter enforces the project bans as errors, whole words only', () => {
		const issues = lintPrompt('Image_1 is Kai. Glitter signs, then a cut to a lens flare. Glittering.', 'seedance', ['glitter', 'lens flare']).issues.filter((i) => i.rule === 'project-rule');
		expect(issues.map((i) => i.match)).toEqual(['Glitter', 'lens flare']);
		expect(issues.every((i) => i.severity === 'error')).toBeTrue();
	});
});
