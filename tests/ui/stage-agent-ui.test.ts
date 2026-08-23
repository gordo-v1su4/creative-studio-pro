import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { getSpeechRecognitionConstructor, mergeTranscript } from '../../src/lib/ui/chat/speech-recognition';

describe('Stage Agent Svelte surface contract', () => {
	test('dictation appends editable text and never submits by itself', () => {
		expect(mergeTranscript('The climax is', ' Nina destroys the formula. ')).toBe('The climax is Nina destroys the formula.');
		expect(mergeTranscript('Keep this answer', '   ')).toBe('Keep this answer');
		expect(getSpeechRecognitionConstructor(undefined)).toBeNull();
	});

	test('offers focus, dock, mobile sheet, keyboard send, and labeled microphone states', async () => {
		const source = await readFile('src/lib/ui/chat/AgentChat.svelte', 'utf8');
		expect(source).toContain("ui.chatMode === 'dock'");
		expect(source).toContain("ui.chatMode = docked ? 'focus' : 'dock'");
		expect(source).toContain('max-sm:inset-0');
		expect(source).toContain('Start voice dictation');
		expect(source).toContain("event.key === 'Enter' && !event.shiftKey");
		expect(source).toContain('Dictation added. Review it before sending.');
	});

	test('removes owner-editable confidence controls from the primary inspector', async () => {
		const stagePanel = await readFile('src/lib/ui/StageGatePanel.svelte', 'utf8');
		expect(stagePanel).toContain('Open Stage Agent');
		expect(stagePanel).not.toContain('overall-confidence');
		expect(stagePanel).not.toContain('score-');
	});
});
