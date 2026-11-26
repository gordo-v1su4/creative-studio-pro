<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { UIMessage } from '@ai-sdk/svelte';
	import type { Project } from '$lib/domain/schemas';
	import { ui } from '$lib/ui/app-state.svelte';
	import { getSpeechRecognitionConstructor, mergeTranscript } from './speech-recognition';
	import type { SpeechRecognitionLike } from './speech-recognition';
	import ProjectModelPanel from './ProjectModelPanel.svelte';
	import StoryChat from './StoryChat.svelte';
	import AgentActions from '$lib/ui/story/AgentActions.svelte';
	import DriftMessage from './DriftMessage.svelte';
	import { agentWork } from '$lib/ui/story/agent-work.svelte';
	import { isDriftQuestion, seriesIdOf } from '$lib/domain/drift';
	import { batchAnswer } from '$lib/domain/drift-batch';
	import EffectsProposal from '$lib/ui/cut/EffectsProposal.svelte';
	import { soundDesk } from '$lib/ui/cut/sound-desk.svelte';

	let { open = $bindable(false), projectTitle = '', project = null }: { open?: boolean; projectTitle?: string; project?: Project | null } = $props();
	type TranscriptMessage = Pick<UIMessage, 'id' | 'role'> & { text: string };
	type AgentData = { project: Project; message: string; next_question: string | null; provider?: string; model?: string };

	/** Brief: the scripted S1 interview. Story: the free story-interview chat on the AI SDK (V1S-282). */
	let mode = $state<'brief' | 'story'>('brief');
	let composer = $state('');
	let pendingQuestion = $state<string | null>(null);
	let assistantMessage = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let loadedProjectId = $state('');
	let loadedVersion = $state<number | null>(null);
	let canDictate = $state(false);
	let listening = $state(false);
	let voiceStatus = $state('');
	let modelLabel = $state('');
	/** Mode, model and the Agent's other actions stay folded away: the panel is a chat first. */
	let more = $state(false);
	let selectedChoice = $state<string | null>(null);
	let otherAnswer = $state('');
	let choiceQuestion = $state('');
	let recognition: SpeechRecognitionLike | null = null;
	let docked = $derived(ui.chatMode === 'dock');
	type DecisionOption = { key: string; text: string };
	function parseDecisionQuestion(value: string | null): { prompt: string; options: DecisionOption[] } {
		if (!value) return { prompt: '', options: [] };
		const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
		const firstOption = lines.findIndex((line) => /^[A-E]\.\s+/.test(line));
		if (firstOption < 0) return { prompt: value, options: [] };
		const options = lines.slice(firstOption).map((line) => {
			const match = line.match(/^([A-E])\.\s+(.+)$/);
			return match ? { key: match[1], text: match[2] } : null;
		}).filter((option): option is DecisionOption => option !== null);
		return options.length === 5 ? { prompt: lines.slice(0, firstOption).join(' '), options } : { prompt: value, options: [] };
	}
	let decision = $derived(parseDecisionQuestion(pendingQuestion));
	/** A project of a series (imported, or built from its story) can always ask "what's out of step?" (Drift 03), with or without an interview question. */
	let inSeries = $derived(Boolean(project && seriesIdOf(project)));
	let asksDrift = $derived(inSeries && isDriftQuestion(composer));
	let answersDrift = $derived(Boolean(project && agentWork.drift?.projectId === project.project_id && batchAnswer(composer, agentWork.drift.report.items)));
	let canSubmit = $derived(!busy && (asksDrift || answersDrift || Boolean(pendingQuestion && (
		decision.options.length === 0 ? composer.trim() : selectedChoice === 'E' ? otherAnswer.trim() : selectedChoice
	))));
	function checkDrift() {
		if (!project) return;
		composer = '';
		void agentWork.checkDrift(project);
	}

	let savedMessages = $derived.by<TranscriptMessage[]>(() => {
		if (!project) return [];
		const messages: TranscriptMessage[] = [];
		for (const round of project.interview.rounds) {
			for (const question of round.questions) {
				messages.push({ id: `q-${question.question_id}`, role: 'assistant', text: question.prompt });
				const answer = round.answers.find((candidate) => candidate.question_id === question.question_id);
				if (answer) messages.push({ id: `a-${question.question_id}`, role: 'user', text: answer.raw_text });
			}
			messages.push({ id: `round-${round.round_id}`, role: 'assistant', text: `Round ${round.round_number}: ${round.overall}/100 · lowest ${round.lowest_dimension.replaceAll('_', ' ')} ${round.lowest_score} · ${round.status}` });
		}
		return messages;
	});

	onMount(() => {
		canDictate = getSpeechRecognitionConstructor(window) !== null;
	});

	onDestroy(() => recognition?.abort());

	async function callAgent(body: Record<string, unknown>): Promise<AgentData> {
		if (!project) throw new Error('Open a project before starting the Agent.');
		const response = await fetch(`/api/projects/${project.project_id}/agent`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const payload = await response.json() as { ok: true; data: AgentData } | { ok: false; error: { message: string } };
		if (!payload.ok) throw new Error(payload.error.message);
		return payload.data;
	}

	async function start(projectSnapshot: Project) {
		if (busy) return;
		busy = true;
		error = null;
		loadedVersion = projectSnapshot.version;
		try {
			const data = await callAgent({ mode: 'start' });
			assistantMessage = data.message;
			pendingQuestion = data.next_question;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The Agent failed to start';
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (pendingQuestion !== choiceQuestion) {
			choiceQuestion = pendingQuestion ?? '';
			selectedChoice = null;
			otherAnswer = '';
		}
		if (!project) {
			loadedProjectId = '';
			loadedVersion = null;
			pendingQuestion = null;
			assistantMessage = '';
			return;
		}
		if (project.project_id !== loadedProjectId) {
			loadedProjectId = project.project_id;
			loadedVersion = null;
			pendingQuestion = null;
			assistantMessage = '';
			composer = '';
			error = null;
		}
		// In focus the interview starts by itself, as it always has. Docked, the Agent stays open beside the work,
		// so it waits to be asked: starting on every project change would call the model without the operator knowing.
		if (open && !docked && loadedVersion !== project.version && !busy) void start(project);
	});

	async function submit() {
		if (asksDrift) return checkDrift();
		// Drift 10: "add all six" answers the drift message's items in one go.
		if (project && agentWork.answerWords(project, composer)) { composer = ''; return; }
		if (!project || !pendingQuestion || !canSubmit || busy) return;
		const option = decision.options.find((candidate) => candidate.key === selectedChoice);
		const primary = selectedChoice === 'E' ? `E. ${otherAnswer.trim()}` : option ? `${option.key}. ${option.text}` : composer.trim();
		const answer = option && composer.trim() ? `${primary}\n\nAdditional context: ${composer.trim()}` : primary;
		busy = true;
		error = null;
		try {
			const data = await callAgent({ mode: 'answer', expected_version: project.version, question: pendingQuestion, answer });
			composer = '';
			selectedChoice = null;
			otherAnswer = '';
			assistantMessage = data.message;
			pendingQuestion = data.next_question;
			loadedVersion = data.project.version;
			ui.adoptActiveProject(data.project);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The Agent could not answer';
		} finally {
			busy = false;
		}
	}

	function selectChoice(option: DecisionOption) {
		selectedChoice = option.key;
		if (option.key !== 'E') otherAnswer = '';
	}

	function onComposerKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	}

	function toggleDictation() {
		if (listening) {
			recognition?.stop();
			return;
		}
		const Constructor = getSpeechRecognitionConstructor(window);
		if (!Constructor) {
			voiceStatus = 'Voice input is unavailable in this browser. Type your answer instead.';
			return;
		}
		recognition = new Constructor();
		recognition.continuous = false;
		recognition.interimResults = false;
		recognition.lang = 'en-US';
		recognition.onresult = (event) => {
			composer = mergeTranscript(composer, event.results[0]?.[0]?.transcript ?? '');
			voiceStatus = 'Dictation added. Review it before sending.';
		};
		recognition.onerror = (event) => {
			voiceStatus = event.error === 'not-allowed' ? 'Microphone permission was denied. Type your answer instead.' : `Voice input failed: ${event.error}`;
		};
		recognition.onend = () => { listening = false; };
		listening = true;
		voiceStatus = 'Listening…';
		try { recognition.start(); }
		catch { listening = false; voiceStatus = 'Voice input could not start. Type your answer instead.'; }
	}
</script>

{#if open}
	{#if !docked}
		<button type="button" class="fixed inset-0 z-40 cursor-default bg-black/65 backdrop-blur-[3px]" transition:fade={{ duration: 140 }} onclick={() => (open = false)} aria-label="Close the Agent"></button>
	{/if}
	<div
		class={docked
			? 'agent-shell agent-docked flex min-h-0 flex-col max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(420px,100vw)] lg:h-full lg:w-full lg:overflow-hidden lg:rounded-[10px]'
			: 'agent-shell fixed left-1/2 top-1/2 z-50 flex h-[min(720px,76vh)] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col shadow-[0_28px_100px_rgba(0,0,0,0.72)] max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0'}
		transition:fly={{ x: docked ? 36 : 0, y: docked ? 0 : -12, duration: 220, easing: quintOut }}
		role="dialog"
		aria-modal={!docked}
		aria-label="Agent conversation"
	>
		<header class="agent-header">
			<span class="grow"></span>
			<button type="button" class="tg" aria-expanded={more} onclick={() => (more = !more)} title="The Agent's mode, model and other actions">{more ? 'Less' : 'More'}</button>
		</header>
		{#if more}
			<div class="agent-more">
				<div class="modes" role="group" aria-label="Agent mode">
					<button type="button" class="tg" aria-pressed={mode === 'brief'} onclick={() => (mode = 'brief')} title="The brief interview">Brief</button>
					<button type="button" class="tg" aria-pressed={mode === 'story'} onclick={() => (mode = 'story')} title="Story interview: idea, three directions, then season and episode structure">Story</button>
					<span class="grow"></span>
					<button type="button" class="tg" onclick={() => (ui.chatMode = docked ? 'focus' : 'dock')} aria-label={docked ? 'Open Agent in focus mode' : 'Dock Agent on the right'}>{docked ? 'Focus' : 'Dock'}</button>
					<button type="button" class="tg" onclick={() => (open = false)} aria-label="Close the Agent">Close</button>
				</div>
				{#if inSeries}<div class="modes"><button type="button" class="tg" disabled={agentWork.busy !== null} onclick={checkDrift} title="Compare Notion's References, every project's Prep and Review Room's reference folders. It only reads.">What's out of step?</button></div>{/if}
				{#if project}<ProjectModelPanel {project} bind:label={modelLabel} />{/if}
			</div>
		{/if}

		{#if project && soundDesk.open}<EffectsProposal />{:else if project && !project.series}<AgentActions {project} buttons={more} />{:else if project}<AgentActions {project} buttons={false} />{/if}
		{#if project}<DriftMessage {project} />{/if}
		{#if mode === 'story' && project}
			<div class="min-h-0 grow px-3 py-3"><div class="mx-auto h-full max-w-2xl"><StoryChat projectId={project.project_id} onDrift={inSeries ? checkDrift : undefined} onDriftWords={inSeries ? (text) => agentWork.answerWords(project!, text) : undefined} /></div></div>
		{:else}
		<div class="agent-transcript min-h-0 grow overflow-y-auto px-3 py-3" aria-live="polite">
			{#if !project}
				<div class="mx-auto mt-16 max-w-md text-center text-text-muted">Open a project to talk with the Agent.</div>
			{:else}
				<div class="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-3">
					{#if docked && !assistantMessage && !pendingQuestion && !busy && !error}
						<button type="button" class="key mr-auto" onclick={() => project && void start(project)}>{savedMessages.length ? 'Continue the interview' : 'Start the interview'}</button>
					{/if}
					{#each savedMessages as message (message.id)}
						<div class={message.role === 'user' ? 'agent-message agent-user ml-auto max-w-[85%]' : 'agent-message agent-assistant'}>
							{#if message.role !== 'user'}<span class="cp who">Agent</span>{/if}
							<p class="whitespace-pre-wrap">{message.text}</p>
						</div>
					{/each}
					{#if assistantMessage || pendingQuestion}
						<div class="agent-message agent-assistant agent-current">
							<span class="cp who">Agent</span>
							{#if assistantMessage}<p class="whitespace-pre-wrap">{assistantMessage}</p>{/if}
							{#if pendingQuestion}
								<strong class="agent-question mt-2 block whitespace-pre-wrap">{decision.prompt}</strong>
								{#if decision.options.length}
									<div class="decision-options mt-3" role="radiogroup" aria-label={decision.prompt}>
										{#each decision.options as option (option.key)}
											<button type="button" class:selected={selectedChoice === option.key} class:other={option.key === 'E'} role="radio" aria-checked={selectedChoice === option.key} onclick={() => selectChoice(option)}>
												<span>{option.key}</span><b>{option.text}</b>
											</button>
										{/each}
									</div>
									{#if selectedChoice === 'E'}
										<input class="other-field mt-2" bind:value={otherAnswer} placeholder="Tell the Agent what you want instead…" aria-label="Something else" />
									{/if}
								{/if}
							{/if}
						</div>
					{/if}
					{#if busy}<p class="cp agent-thinking">Thinking<span class="agent-cursor" aria-hidden="true"></span></p>{/if}
					{#if error}
						<div class="agent-error" role="alert">
							<p>{error}</p>
							{#if !pendingQuestion}<button type="button" class="key mt-2" onclick={() => project && void start(project)}>Retry</button>{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<footer class="agent-footer">
			<div class="mx-auto max-w-2xl">
				<div class="agent-composer">
					<textarea bind:value={composer} onkeydown={onComposerKeydown} rows="1" class="max-h-28 grow resize-none bg-transparent outline-none" placeholder={pendingQuestion ? decision.options.length ? 'Add optional details…' : 'Answer or add context…' : inSeries ? 'Ask what’s out of step…' : 'Waiting for the next question…'} disabled={!project || (!pendingQuestion && !inSeries) || busy}></textarea>
					<button type="button" class={['agent-mic', listening && 'is-listening']} onclick={toggleDictation} disabled={!project || !pendingQuestion || busy} aria-pressed={listening} aria-label={listening ? 'Stop dictation' : 'Start voice dictation'} title={canDictate ? 'Push to talk' : 'Voice input may be unavailable'}>
						<svg class="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<rect x="9" y="2" width="6" height="12" rx="3"></rect>
							<path d="M5.5 10.5a6.5 6.5 0 0 0 13 0"></path>
							<path d="M12 17v5"></path>
							<path d="M8.5 22h7"></path>
						</svg>
					</button>
					<button type="button" class="key agent-send" onclick={() => void submit()} disabled={!canSubmit}>{busy ? '…' : decision.options.length && !asksDrift ? 'Continue' : 'Send'}</button>
				</div>
				{#if voiceStatus}<p class="agent-status">{voiceStatus}</p>{/if}
			</div>
		</footer>
		{/if}
	</div>
{/if}

<style>
	/*
	 * The Agent's chat (look B, revised 2026-11-24): black and zinc greys, plain text, no boxes and no borders.
	 * Purple belongs to the Agent: a wash that rises from the composer and fades out halfway up, its name, and Send.
	 * No pink, no teal, no pattern behind the text.
	 */
	.agent-shell {
		--glow: linear-gradient(to top, #2a1f5c 0, #1a1438 14%, #0f0d1c 34%, var(--color-panel) 58%);
		border: 0;
		border-radius: 10px;
		background: var(--glow);
		color: var(--color-ink-2);
		font: 12.5px/1.5 var(--font-sans);
	}
	.agent-shell.agent-docked { box-shadow: none; }

	.agent-header { display: flex; flex: none; align-items: center; padding: 6px 6px 0; }
	.agent-more { display: flex; flex: none; flex-direction: column; gap: 6px; padding: 4px 10px 6px; }
	.modes { display: flex; align-items: center; gap: 1px; margin: 0 -4px; }
	.modes .tg[aria-pressed='true'] { background: var(--color-control); color: var(--color-ink); }

	.agent-transcript { scrollbar-color: #26262b transparent; }
	.agent-thinking, .who { margin: 0; color: var(--color-ink-3); }
	.who { display: block; margin-bottom: 3px; color: #8f86b8; }

	.agent-message { color: #c8c8ce; line-height: 1.5; }
	.agent-user { border-radius: 9px; background: var(--color-control); padding: 4px 9px; color: var(--color-ink); }
	.agent-question { display: block; color: var(--color-ink); font-weight: 400; }

	.decision-options { display: flex; flex-direction: column; }
	.decision-options button {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		align-items: baseline;
		gap: 8px;
		width: 100%;
		border: 0;
		border-radius: 5px;
		background: none;
		padding: 3px 6px;
		color: var(--color-ink-2);
		text-align: left;
		cursor: pointer;
	}
	.decision-options button > span { color: var(--color-ink-3); font: 10.5px var(--font-mono); }
	.decision-options button > b { font-weight: 400; line-height: 1.45; }
	.decision-options button:hover, .decision-options button:focus-visible { background: var(--color-raised); color: var(--color-ink); outline: none; }
	.decision-options button.selected { background: var(--color-control); color: var(--color-ink); }
	.decision-options button.selected > span { color: var(--color-agent-purple); }

	.other-field {
		width: 100%;
		border: 0;
		border-radius: 6px;
		background: var(--color-raised);
		padding: 6px 8px;
		color: var(--color-ink);
		font: 12.5px/1.4 var(--font-sans);
		outline: none;
	}
	.other-field:focus-visible { outline: 2px solid var(--color-agent-purple); outline-offset: -1px; }

	.agent-cursor { display: inline-block; width: 5px; height: 10px; margin-left: 5px; vertical-align: -1px; background: var(--color-ink-3); animation: agent-blink 1.05s steps(1) infinite; }
	.agent-error { color: #ff7a6b; }

	.agent-footer { flex: none; padding: 6px; }
	.agent-composer { display: flex; align-items: center; gap: 4px; border-radius: 9px; background: #ffffff0d; padding: 4px 4px 4px 10px; }
	.agent-composer::before { content: '>'; color: var(--color-ink-3); font: 11px var(--font-mono); }
	.agent-composer textarea { min-height: 24px; padding: 3px 0; color: var(--color-ink); font: inherit; caret-color: var(--color-agent-purple); }
	.agent-composer textarea::placeholder { color: var(--color-ink-3); }
	.agent-mic { display: inline-flex; width: 22px; height: 20px; flex: none; align-items: center; justify-content: center; border: 0; border-radius: 5px; background: none; color: var(--color-agent-purple); cursor: pointer; }
	.agent-mic.is-listening { background: var(--color-agent-purple-deep); color: #d8cffc; }
	.agent-mic:disabled { opacity: 0.4; cursor: default; }
	.agent-send { background: var(--color-agent-purple-deep); color: #d8cffc; }
	.agent-send:hover:not(:disabled) { background: #342b63; }
	.agent-status { margin: 0; padding: 4px 6px 0; color: var(--color-ink-3); font-size: 10.5px; }

	@keyframes agent-blink { 50% { opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .agent-cursor { animation: none; } }
	@media (max-width: 640px) { .agent-shell { inset: 0 !important; width: 100% !important; border-radius: 0; } }
</style>
