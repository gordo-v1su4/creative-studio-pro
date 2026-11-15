import type { PrepState } from './prep';
export function joeyPrerequisites(state: PrepState): string[] {
	const flow = state.workflow;
	if (!flow) return [];
	const issues: string[] = [];
	if (!state.spec) issues.push('Draft and review the facts first');
	if (!state.sources.length && !state.spec?.notes && !state.spec?.identity?.face) issues.push('Supply an image or a written design');
	if (['outfit', 'sheet', 'coverage'].includes(flow.stage) && !state.sources.some(source => source.url === flow.approved_source_url)) issues.push(flow.stage === 'outfit' ? 'Choose an approved face lock' : flow.stage === 'sheet' ? 'Choose an approved outfit image' : 'Choose an approved location master');
	return issues;
}
export function joeyPromptIssues(prompt: string, state: PrepState): string[] {
	const issues = joeyPrerequisites(state);
	if (!state.workflow?.confirmed) issues.push('Confirm the pre-prompt check first');
	if (state.workflow?.builder === 'castkit-v1') {
		if (!/18%\s*(neutral\s*)?gr[ae]y/i.test(prompt)) issues.push('Use Castkit’s flat 18% neutral gray field');
		if (!/shadowless/i.test(prompt)) issues.push('Keep character-reference lighting shadowless');
		if (state.workflow.stage === 'sheet' && (!/LEFT PANEL/i.test(prompt) || !/CENTER PANEL/i.test(prompt) || !/RIGHT PANEL/i.test(prompt) || !/headless|no head/i.test(prompt))) issues.push('Use Castkit’s front / rear / face three-panel sheet');
	} else if (!/NO ON-SCREEN TEXT:/i.test(prompt)) issues.push('Keep Scenecraft’s overlay line in the location prompt');
	return issues;
}
