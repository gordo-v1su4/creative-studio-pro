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

	let { open = $bindable(false), projectTitle = '', project = null }: { open?: boolean; projectTitle?: string; project?: Project | null } = $props();
	type TranscriptMessage = Pick<UIMessage, 'id' | 'role'> & { text: string };
	type AgentData = { project: Project; message: string; next_question: string | null; provider?: string; model?: string };

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
	let canSubmit = $derived(Boolean(pendingQuestion && !busy && (
		decision.options.length === 0 ? composer.trim() : selectedChoice === 'E' ? otherAnswer.trim() : selectedChoice
	)));

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
		if (!project) throw new Error('Open a project before starting the Stage Agent.');
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
			error = cause instanceof Error ? cause.message : 'Stage Agent failed to start';
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
		if (open && loadedVersion !== project.version && !busy) void start(project);
	});

	async function submit() {
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
			error = cause instanceof Error ? cause.message : 'Stage Agent answer failed';
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
		<button type="button" class="fixed inset-0 z-40 cursor-default bg-black/65 backdrop-blur-[3px]" transition:fade={{ duration: 140 }} onclick={() => (open = false)} aria-label="Close Stage Agent"></button>
	{/if}
	<div
		class={docked
			? 'agent-shell fixed inset-y-12 right-0 z-40 flex w-[420px] max-w-full flex-col border-l shadow-[-18px_0_60px_rgba(0,0,0,0.55)]'
			: 'agent-shell fixed left-1/2 top-1/2 z-50 flex h-[min(720px,76vh)] w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col border shadow-[0_28px_100px_rgba(0,0,0,0.72)] max-sm:inset-0 max-sm:h-full max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0'}
		transition:fly={{ x: docked ? 36 : 0, y: docked ? 0 : -12, duration: 220, easing: quintOut }}
		role="dialog"
		aria-modal={!docked}
		aria-label="Stage Agent conversation"
	>
		<header class="agent-header flex min-h-14 items-center gap-3 px-4 py-2.5">
			<span class="agent-prompt text-[18px] font-bold" aria-hidden="true">&gt;</span>
			<div class="min-w-0 grow">
				<div class="flex items-center gap-3">
					<div class="agent-wordmark"><span>NERATE</span><small>STORYHELPER™</small></div>
					<div class="slash-rule" aria-hidden="true"></div>
				</div>
				<div class="agent-path truncate">~\projects\{projectTitle || 'no-project'} · {project?.stage.id ?? '—'} · {modelLabel || 'model'}</div>
			</div>
			<button type="button" class="agent-key" onclick={() => (ui.chatMode = docked ? 'focus' : 'dock')} aria-label={docked ? 'Open Agent in focus mode' : 'Dock Agent on the right'}>{docked ? 'focus' : 'dock'}</button>
			<button type="button" class="agent-key" onclick={() => (open = false)} aria-label="Close Stage Agent">esc</button>
		</header>

		<div class="agent-transcript min-h-0 grow overflow-y-auto px-4 py-4" aria-live="polite">
			{#if !project}
				<div class="mx-auto mt-16 max-w-md text-center text-text-muted">Open a project to begin a Stage Agent conversation.</div>
			{:else}
				<div class="mx-auto grid max-w-2xl gap-3">
					<ProjectModelPanel {project} bind:label={modelLabel} />
					{#if savedMessages.length === 0}
						<div class="agent-section-label"><span>&gt;</span> S1 interview · no saved rounds yet</div>
					{/if}
					{#each savedMessages as message (message.id)}
						<div class={message.role === 'user' ? 'agent-message agent-user ml-auto max-w-[88%] px-3 py-2.5' : 'agent-message agent-assistant mr-auto max-w-[94%] px-3 py-2.5'}>
							<p class="whitespace-pre-wrap">{message.text}</p>
						</div>
					{/each}
					{#if assistantMessage || pendingQuestion}
						<div class="agent-message agent-assistant agent-current mr-auto max-w-[94%] px-3 py-3">
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
										<input class="other-field mt-2" bind:value={otherAnswer} placeholder="Tell NERATE what you want instead…" aria-label="Something else" />
									{/if}
								{/if}
							{/if}
						</div>
					{/if}
					{#if busy}<div class="agent-thinking mr-auto px-3 py-2"><span>&gt;</span> thinking<span class="agent-cursor" aria-hidden="true"></span></div>{/if}
					{#if error}
						<div class="rounded-md border border-gate-failed px-3 py-2 text-gate-failed" role="alert">
							<p>{error}</p>
							{#if !pendingQuestion}<button type="button" class="btn mt-2" onclick={() => project && void start(project)}>Retry</button>{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<footer class="agent-footer p-2.5">
			<div class="mx-auto max-w-2xl">
				<div class="agent-composer flex items-end gap-2 p-2">
					<textarea bind:value={composer} onkeydown={onComposerKeydown} rows="1" class="max-h-28 min-h-9 grow resize-none bg-transparent px-1 py-2 text-[12px] text-text-primary outline-none placeholder:text-text-dim" placeholder={pendingQuestion ? decision.options.length ? 'Add optional details…' : 'Answer or add context…' : 'Waiting for the next question…'} disabled={!project || !pendingQuestion || busy}></textarea>
					<button type="button" class={['agent-key h-9 w-9 shrink-0 justify-center', listening && 'is-listening']} onclick={toggleDictation} disabled={!project || !pendingQuestion || busy} aria-pressed={listening} aria-label={listening ? 'Stop dictation' : 'Start voice dictation'} title={canDictate ? 'Push to talk' : 'Voice input may be unavailable'}>
						<svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<rect x="9" y="2" width="6" height="12" rx="3"></rect>
							<path d="M5.5 10.5a6.5 6.5 0 0 0 13 0"></path>
							<path d="M12 17v5"></path>
							<path d="M8.5 22h7"></path>
						</svg>
					</button>
					<button type="button" class="agent-send h-9 shrink-0 px-3" onclick={() => void submit()} disabled={!canSubmit}>{busy ? '…' : decision.options.length ? 'continue ↵' : 'send ↵'}</button>
				</div>
				<div class="agent-status mt-1.5 flex min-h-4 items-center gap-2">
					<span>{voiceStatus || 'Enter sends · Shift+Enter adds a line'}</span>
					<span class="grow"></span>
					{#if project}<span>v{project.version} · {project.interview.status}</span>{/if}
				</div>
			</div>
		</footer>
	</div>
{/if}

<style>
	.agent-shell {
		--agent-teal: #4ee8d2;
		--agent-cyan: #48bdf5;
		--agent-violet: #7770f7;
		--agent-ink: #0c0d12;
		--agent-panel: #13151c;
		--agent-muted: #7f8794;
		border-color: color-mix(in srgb, var(--agent-teal) 68%, #28313a);
		background:
			linear-gradient(180deg, rgba(78, 232, 210, 0.035), transparent 22%),
			var(--agent-ink);
		color: #d8e3e7;
		font-family: var(--font-mono);
		border-radius: 2px;
		box-shadow:
			0 0 0 1px rgba(72, 189, 245, 0.1),
			0 28px 100px rgba(0, 0, 0, 0.72),
			0 0 34px rgba(78, 232, 210, 0.07);
	}

	.agent-header {
		border-bottom: 1px solid rgba(78, 232, 210, 0.24);
		background: #101219;
	}

	.agent-wordmark {
		display: flex;
		align-items: baseline;
		gap: 10px;
		color: var(--agent-teal);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: 0.11em;
		line-height: 1;
		text-shadow: 0 0 16px rgba(78, 232, 210, 0.22);
	}

	.agent-wordmark small {
		color: color-mix(in srgb, var(--agent-cyan) 78%, #d8e3e7);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.12em;
	}

	.agent-path,
	.agent-status {
		color: #647f8a;
		font-size: 10px;
		letter-spacing: 0.02em;
	}

	.agent-path {
		margin-top: 5px;
	}

	.slash-rule {
		min-width: 48px;
		flex: 1;
		height: 10px;
		background: repeating-linear-gradient(118deg, transparent 0 6px, rgba(72, 189, 245, 0.7) 6px 8px, transparent 8px 12px);
		mask-image: linear-gradient(90deg, #000, rgba(0, 0, 0, 0.15));
	}

	.agent-prompt {
		color: var(--agent-teal);
		font-family: var(--font-mono);
		text-shadow: 0 0 12px rgba(78, 232, 210, 0.36);
	}

	.agent-key,
	.agent-send {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(72, 189, 245, 0.38);
		border-radius: 1px;
		background: rgba(72, 189, 245, 0.05);
		color: #aab6bf;
		font: 600 10px/1 var(--font-mono);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.agent-key:not(:disabled):hover,
	.agent-key:focus-visible {
		border-color: var(--agent-teal);
		color: var(--agent-teal);
		outline: none;
	}

	.agent-key:disabled,
	.agent-send:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.agent-key.is-listening {
		border-color: var(--agent-violet);
		color: #a9a3ff;
		box-shadow: 0 0 16px rgba(119, 112, 247, 0.18);
	}

	.agent-transcript {
		background-image: radial-gradient(rgba(78, 232, 210, 0.075) 0.7px, transparent 0.7px);
		background-size: 15px 15px;
		scrollbar-color: rgba(78, 232, 210, 0.35) transparent;
	}

	.agent-section-label {
		color: #69727f;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.agent-section-label span {
		color: var(--agent-teal);
	}

	.agent-message {
		border-radius: 1px;
		font-size: 11px;
		line-height: 1.6;
	}

	.agent-assistant {
		border-left: 2px solid rgba(72, 189, 245, 0.55);
		background: rgba(19, 21, 28, 0.88);
		color: #82aeb9;
	}

	.agent-current {
		border: 1px solid rgba(72, 189, 245, 0.38);
		border-left: 2px solid var(--agent-teal);
		box-shadow: inset 0 0 28px rgba(72, 189, 245, 0.025);
	}

	.agent-user {
		border: 1px solid rgba(78, 232, 210, 0.4);
		background: linear-gradient(90deg, rgba(78, 232, 210, 0.11), rgba(119, 112, 247, 0.07));
		color: #a9e8df;
	}

	.agent-question {
		color: #84d9ea;
		font-weight: 600;
		letter-spacing: 0.005em;
	}

	.agent-question::before {
		content: '> ';
		color: var(--agent-teal);
	}

	.decision-options {
		display: grid;
		gap: 0;
	}

	.decision-options button {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr);
		align-items: start;
		gap: 7px;
		width: 100%;
		border: 1px solid transparent;
		border-radius: 2px;
		background: transparent;
		padding: 3px 5px;
		color: #789da7;
		text-align: left;
		cursor: pointer;
		transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
	}

	.decision-options button > span {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border: 1px solid #30434b;
		border-radius: 2px;
		color: #8aabb3;
		font: 700 10px/1 var(--font-mono);
	}

	.decision-options button > b {
		padding-top: 2px;
		font-size: 11px;
		font-weight: 500;
		line-height: 1.45;
	}

	.decision-options button:hover,
	.decision-options button:focus-visible {
		border-color: transparent;
		background: rgba(72, 189, 245, 0.055);
		color: #9ac8d0;
		outline: none;
	}

	.decision-options button.selected {
		border-color: transparent;
		background: rgba(78, 232, 210, 0.1);
		color: #b7ebe7;
	}

	.decision-options button.selected > span {
		border-color: var(--agent-teal);
		background: var(--agent-teal);
		color: #071311;
	}

	.decision-options button.other.selected {
		background: linear-gradient(90deg, rgba(78, 232, 210, 0.13), rgba(72, 189, 245, 0.07));
	}

	.other-field {
		width: 100%;
		border: 1px solid rgba(78, 232, 210, 0.48);
		border-radius: 2px;
		background: #090d12;
		padding: 9px 10px;
		color: #a9e8df;
		font: 11px/1.4 var(--font-mono);
		caret-color: var(--agent-teal);
		outline: none;
	}

	.other-field:focus {
		border-color: var(--agent-teal);
		box-shadow: 0 0 0 1px rgba(78, 232, 210, 0.1);
	}

	.agent-thinking {
		color: var(--agent-muted);
		font-size: 11px;
		letter-spacing: 0.04em;
	}

	.agent-thinking > span:first-child {
		color: var(--agent-teal);
	}

	.agent-cursor {
		display: inline-block;
		width: 6px;
		height: 12px;
		margin-left: 4px;
		vertical-align: -2px;
		background: var(--agent-teal);
		animation: agent-blink 1.05s steps(1) infinite;
	}

	.agent-footer {
		border-top: 1px solid rgba(78, 232, 210, 0.2);
		background: #101219;
	}

	.agent-composer {
		border: 1px solid rgba(72, 189, 245, 0.4);
		border-radius: 1px;
		background: #0a0c11;
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}

	.agent-composer:focus-within {
		border-color: var(--agent-teal);
		box-shadow: 0 0 0 1px rgba(78, 232, 210, 0.12), 0 0 22px rgba(78, 232, 210, 0.07);
	}

	.agent-composer textarea {
		font-family: var(--font-mono);
		caret-color: var(--agent-teal);
	}

	.agent-send {
		border-color: rgba(78, 232, 210, 0.72);
		background: rgba(78, 232, 210, 0.13);
		color: #b9fff4;
	}

	.agent-send:not(:disabled):hover,
	.agent-send:focus-visible {
		background: rgba(78, 232, 210, 0.21);
		box-shadow: 0 0 18px rgba(78, 232, 210, 0.1);
		outline: none;
	}

	@keyframes agent-blink {
		50% { opacity: 0; }
	}

	@media (prefers-reduced-motion: reduce) {
		.agent-cursor { animation: none; }
	}

	@media (max-width: 640px) {
		.agent-shell {
			inset: 0 !important;
			width: 100% !important;
			border-radius: 0;
		}

		.slash-rule { display: none; }
		.agent-wordmark { font-size: 14px; }
		.agent-wordmark small { font-size: 8px; }
	}
</style>
