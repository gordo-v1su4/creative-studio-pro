export type SpeechRecognitionResultEventLike = {
	results: ArrayLike<{ 0: { transcript: string } }>;
};

export type SpeechRecognitionLike = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
	SpeechRecognition?: SpeechRecognitionConstructor;
	webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function getSpeechRecognitionConstructor(source: Window | undefined): SpeechRecognitionConstructor | null {
	if (!source) return null;
	const speechWindow = source as SpeechWindow;
	return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function mergeTranscript(current: string, transcript: string): string {
	const clean = transcript.trim();
	if (!clean) return current;
	return current.trim() ? `${current.trimEnd()} ${clean}` : clean;
}
