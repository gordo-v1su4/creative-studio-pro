/**
 * The owner brief and the project rules file (V1S-132). The rules file
 * (e.g. trailer/PROMPT-RULES.md) is the source the Agent and the prompt
 * linter read; the brief's tone and must-nots live in one managed section of
 * it, rewritten whenever the brief is saved. A must-not that quotes a word or
 * phrase ("glitter") makes that word a hard lint error in every prompt.
 */

const START = '<!-- narrate:brief -->';
const END = '<!-- /narrate:brief -->';

/** The rules file with the brief's section written (replaced in place, or added at the end). */
export function writeBriefSection(rules: string, brief: { tone: string; mustNots: string[] }): string {
	const section = [
		START,
		'## From the owner brief',
		'',
		'### Tone and visual rules',
		'',
		brief.tone.trim() || '(none)',
		'',
		'### Must not',
		'',
		...(brief.mustNots.length ? brief.mustNots.map((line) => `- ${line.trim()}`) : ['- (none)']),
		END
	].join('\n');
	const start = rules.indexOf(START);
	const end = rules.indexOf(END);
	if (start >= 0 && end > start) return `${rules.slice(0, start)}${section}${rules.slice(end + END.length)}`;
	const body = rules.trimEnd();
	return `${body ? `${body}\n\n` : '# Project prompt rules\n\n'}${section}\n`;
}

/** Words and phrases the brief's must-nots quote ("…" or “…”): banned from prompts. */
export function bannedTerms(rules: string | null): string[] {
	if (!rules) return [];
	const start = rules.indexOf(START);
	const end = rules.indexOf(END);
	if (start < 0 || end <= start) return [];
	const section = rules.slice(start, end);
	const mustNot = section.slice(section.indexOf('### Must not'));
	const terms = new Set<string>();
	for (const match of mustNot.matchAll(/["“]([^"”\n]{2,60})["”]/g)) terms.add(match[1].trim().toLowerCase());
	return [...terms];
}
