import { handlesIn } from './handles';

/**
 * Scene checks for Fit (V1S-329), deterministic: every line of the scene's Dialogue is placed in exactly one
 * shot, verbatim (and spoken in that shot's video prompt), nothing is changed or invented; prompts use only
 * the scene's references. The Agent's own checklist (action in order, story beats shown) runs on top.
 */

/** One scripted line: `KAI (low, to Mara): "Don't."` */
export interface DialogueLine { speaker: string; delivery: string; line: string }

const LINE = /^\s*[-*]?\s*([^():"“”\n]+?)\s*(?:\(([^)]*)\))?\s*:\s*["“](.+?)["”]\s*$/;
const squashSpaces = (text: string) => text.replace(/\s+/g, ' ').trim();
const plainQuotes = (text: string) => text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const sameWords = (text: string) => plainQuotes(squashSpaces(text));
const speakerKey = (speaker: string) => squashSpaces(speaker).toUpperCase();
/** Case and punctuation ignored: tells a changed line from an invented one. */
const loose = (text: string) => plainQuotes(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function dialogueLines(text: string): DialogueLine[] {
	return text.split('\n').flatMap((row) => {
		const m = row.match(LINE);
		return m ? [{ speaker: squashSpaces(m[1]), delivery: squashSpaces(m[2] ?? ''), line: sameWords(m[3]) }] : [];
	});
}

export const lineText = (line: DialogueLine) => `${line.speaker}${line.delivery ? ` (${line.delivery})` : ''}: "${line.line}"`;

export interface ShotForCheck { title: string; dialogue: string; video_prompt: string }

export interface DialogueCheck {
	missing: DialogueLine[];
	/** A shot's line by a scene speaker whose words differ from the script. */
	changed: Array<{ shot: string; line: DialogueLine; script: DialogueLine }>;
	/** A shot's line that matches nothing in the script. */
	invented: Array<{ shot: string; line: DialogueLine }>;
	/** A scripted line placed in more than one shot. */
	repeated: Array<{ line: DialogueLine; shots: string[] }>;
	/** A placed line whose words are not quoted in that shot's video prompt. */
	unspoken: Array<{ shot: string; line: DialogueLine }>;
}

/**
 * Check the scene's script against its shots. `placed` are the shots already on the board (their lines count
 * as placed and are not re-checked against their prompts); `shots` are the new ones.
 */
export function checkDialogue(script: string, shots: ShotForCheck[], placed: ShotForCheck[] = []): DialogueCheck {
	const lines = dialogueLines(script);
	const result: DialogueCheck = { missing: [], changed: [], invented: [], repeated: [], unspoken: [] };
	const where = new Map<number, string[]>();
	const changedScript = new Set<number>();
	for (const [isNew, list] of [[false, placed], [true, shots]] as const) {
		for (const shot of list) {
			for (const said of dialogueLines(shot.dialogue)) {
				const exact = lines.findIndex((line) => speakerKey(line.speaker) === speakerKey(said.speaker) && line.line === said.line);
				if (exact >= 0) {
					where.set(exact, [...(where.get(exact) ?? []), shot.title]);
					if (isNew && !plainQuotes(shot.video_prompt).includes(`"${said.line}"`)) result.unspoken.push({ shot: shot.title, line: said });
					continue;
				}
				if (!isNew) continue;
				const near = lines.findIndex((line) => loose(line.line) === loose(said.line) || (speakerKey(line.speaker) === speakerKey(said.speaker) && sharesWords(line.line, said.line)));
				if (near >= 0) { result.changed.push({ shot: shot.title, line: said, script: lines[near] }); changedScript.add(near); }
				else result.invented.push({ shot: shot.title, line: said });
			}
		}
	}
	lines.forEach((line, i) => {
		const at = where.get(i) ?? [];
		if (at.length === 0 && !changedScript.has(i)) result.missing.push(line);
		if (at.length > 1) result.repeated.push({ line, shots: at });
	});
	return result;
}

/** Half or more of the script line's words appear in the said line. */
function sharesWords(script: string, said: string): boolean {
	const words = loose(script).split(' ').filter((word) => word.length > 2);
	if (words.length === 0) return false;
	const heard = new Set(loose(said).split(' '));
	return words.filter((word) => heard.has(word)).length / words.length >= 0.5;
}

/** Handles the shots use that are not the scene's references (or match no reference at all). */
export function strayHandles(shots: Array<Pick<ShotForCheck, 'title' | 'video_prompt'>>, allowed: string[]): Array<{ shot: string; handle: string }> {
	const ok = new Set(allowed.map((handle) => handle.toLowerCase()));
	return shots.flatMap((shot) => [...new Set(handlesIn(shot.video_prompt))].filter((handle) => !ok.has(handle.toLowerCase())).map((handle) => ({ shot: shot.title, handle })));
}

/** Every problem as one line for the Agent and the operator; empty = the scene passes. */
export function sceneProblems(check: DialogueCheck, stray: Array<{ shot: string; handle: string }>): string[] {
	return [
		...check.missing.map((line) => `Dialogue line not placed in any shot: ${lineText(line)}`),
		...check.changed.map((entry) => `${entry.shot}: dialogue changed. The script says ${lineText(entry.script)}; the shot has ${lineText(entry.line)}`),
		...check.invented.map((entry) => `${entry.shot}: dialogue not in the script: ${lineText(entry.line)}`),
		...check.repeated.map((entry) => `Dialogue line placed in more than one shot (${entry.shots.join(', ')}): ${lineText(entry.line)}`),
		...check.unspoken.map((entry) => `${entry.shot}: its video prompt does not speak "${entry.line.line}" in quotes`),
		...stray.map((entry) => `${entry.shot}: ${entry.handle} is not one of this scene's references`)
	];
}
