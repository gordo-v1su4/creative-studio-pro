import type { Project } from '$lib/domain/schemas';
import type { SeriesRecord } from './series';
import { seriesIdOf, type DriftChoice } from '$lib/domain/drift';
import type { BatchEvent } from '$lib/domain/drift-batch';
import { kindOf, sameName, type PrepKind } from '$lib/domain/prep';
import { readReferences } from './notion';
import { prepContext, readPrep } from './prep';
import { addReference, type AddReferenceDeps } from './drift';
import type { ReviewRoomClient } from './review-room';

/**
 * One answer for several drift items (Drift 10, GitHub #38 / V1S-514; spec GitHub #28, stories 38-41; ADR 0012). The
 * first write runs alone and is read back from Notion before the rest go, so a mistake hits one reference, not
 * sixteen. The rest go one at a time. Each write is said as it runs and as it ends; a failure stops the batch there,
 * leaves the rest untouched and says why. Anything wrong with the answer as a whole is refused before any write.
 * Only "add to Notion" has a writer today; link and mark as old join by adding theirs to `WRITERS`.
 */

export interface DriftAnswer {
	/** The drift item's key, as the check gave it. */
	key: string;
	choice: DriftChoice;
	kind: PrepKind;
	/** The exact name to write, as the operator settled it. */
	name: string;
	/** The project whose Prep it was found in (an item is added from there). */
	project_id: string;
	/** The spellings it has in that Prep, so its Prep work moves to the new page. */
	former_names?: string[];
}
export type { BatchEvent };
export type BatchResult =
	| { ok: true; done: string[]; untouched: [] }
	| { ok: false; status: number; message: string; done: string[]; failed?: string; untouched: string[] };

export type DriftBatchDeps = AddReferenceDeps & Required<Pick<AddReferenceDeps, 'store'>> & {
	/** Review Room, for the choices that will write there (link, mark as old). Adding to Notion never touches it. */
	client?: Pick<ReviewRoomClient, 'changes'> | ReviewRoomClient | null;
};

type Failure = { ok: false; status: number; message: string };
type Context = { deps: DriftBatchDeps; record: SeriesRecord; projects: Map<string, Project> };
interface Writer {
	/** What it is doing, said before it starts. */
	doing(answer: DriftAnswer): string;
	write(context: Context, answer: DriftAnswer): Promise<{ ok: true; said: string; check: () => Promise<{ ok: true; said: string } | Failure> } | Failure>;
}

const KIND_IN_NOTION: Record<PrepKind, string> = { character: 'Character', location: 'Location', prop: 'Prop' };
const VERB: Record<DriftChoice, string> = { add_to_notion: 'Adding to Notion', link: 'Linking', mark_old: 'Marking as old', remake: 'Remaking', restore_name: 'Putting the old name back', new_reference: 'Making a new reference' };
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/, '');

const WRITERS: Partial<Record<DriftChoice, Writer>> = {
	add_to_notion: {
		doing: (answer) => `Adding ${answer.name} to Notion`,
		async write({ deps, record, projects }, answer) {
			const project = projects.get(answer.project_id)!;
			const added = await addReference(deps, project, { kind: answer.kind, name: answer.name, former_names: answer.former_names });
			if (!added.ok) return added;
			const said = `${answer.name} is in Notion's References now, and in ${project.title}'s Prep.`;
			// The check reads Notion and the Prep file again, as they are now, not as the write said they would be.
			const check = async (): Promise<{ ok: true; said: string } | Failure> => {
				let pages;
				try { pages = await readReferences(deps.notion!, record.references!.source!); } catch (cause) { return { ok: false, status: 502, message: `Notion could not be read to check ${answer.name}: ${reason(cause)}.` }; }
				const page = pages.find((ref) => ref.page_id === added.page_id);
				if (!page) return { ok: false, status: 502, message: `Notion does not list ${answer.name} among the References.` };
				if (page.name !== answer.name) return { ok: false, status: 502, message: `Notion lists the new page as ${page.name}, not ${answer.name}.` };
				if (kindOf(page.kind) !== answer.kind) return { ok: false, status: 502, message: `Notion lists ${answer.name} as a ${page.kind || 'reference with no kind'}, not a ${KIND_IN_NOTION[answer.kind]}.` };
				const prep = await readPrep(deps.projectRoot, project.project_id);
				if (!(prep.custom_entries ?? []).some((entry) => entry.reference_page_id === added.page_id)) return { ok: false, status: 500, message: `${project.title}'s Prep does not point at the new page for ${answer.name}.` };
				return { ok: true, said: `${answer.name} is in Notion as a ${KIND_IN_NOTION[answer.kind]}, and ${project.title}'s Prep points at it.` };
			};
			return { ok: true, said, check };
		}
	}
};

const others = (count: number) => (count === 1 ? 'the other one' : `the other ${count}`);
const notTouched = (count: number) => (count ? ` ${count === 1 ? 'The other one was' : `The other ${count} were`} not touched.` : '');

/**
 * Answers several drift items: refuses the whole answer before writing if any part of it cannot be done, then writes
 * the first alone and checks it, then the rest in order. `say` hears every line as it happens.
 */
export async function answerDrift(deps: DriftBatchDeps, project: Project, answers: DriftAnswer[], say: (event: BatchEvent) => void): Promise<BatchResult> {
	const refuse = (status: number, message: string): BatchResult => ({ ok: false, status, message: `${message} Nothing was written.`, done: [], untouched: answers.map((answer) => answer.key) });
	if (!answers.length) return refuse(400, 'No items were given.');
	for (const answer of answers) {
		if (!WRITERS[answer.choice]) return refuse(400, `${VERB[answer.choice]} cannot be done from the chat yet.`);
		if (!answer.name.trim()) return refuse(400, 'Every item needs a name.');
	}
	const keys = new Set<string>();
	for (const [i, answer] of answers.entries()) {
		if (keys.has(answer.key) || answers.slice(0, i).some((before) => before.kind === answer.kind && sameName(before.name, answer.name))) return refuse(400, `${answer.name.trim()} is in this answer twice.`);
		keys.add(answer.key);
	}
	const { record } = await prepContext(deps, project);
	if (!record) return refuse(409, 'This project is not part of a Notion series.');
	if (!record.references?.source) return refuse(409, `${record.title} has no References database in Notion; re-check the series.`);
	if (!deps.notion) return refuse(503, 'Notion is not connected.');
	const projects = new Map<string, Project>([[project.project_id, project]]);
	for (const answer of answers) {
		if (projects.has(answer.project_id)) continue;
		const found = await deps.store.readProject(answer.project_id).catch(() => null);
		if (!found) return refuse(404, `A project in this answer was not found.`);
		if (seriesIdOf(found) !== record.series_id) return refuse(400, `${found.title} is not a project of ${record.title}.`);
		projects.set(answer.project_id, found);
	}
	if (seriesIdOf(project) !== record.series_id) return refuse(400, `${project.title} is not a project of ${record.title}.`);

	const context: Context = { deps, record, projects };
	const done: string[] = [];
	for (const [i, answer] of answers.entries()) {
		const answerNow = { ...answer, name: answer.name.trim() };
		const writer = WRITERS[answer.choice]!;
		const left = answers.length - i - 1;
		const untouched = answers.slice(i + 1).map((rest) => rest.key);
		say({ key: answer.key, state: 'doing', text: `${writer.doing(answerNow)}${i === 0 && left ? ', alone first' : ''}…` });
		const written = await writer.write(context, answerNow).catch((cause): Failure => ({ ok: false, status: 500, message: `${answerNow.name} could not be written: ${reason(cause)}.` }));
		if (!written.ok) {
			say({ key: answer.key, state: 'failed', text: `${written.message}${notTouched(left)}` });
			return { ok: false, status: written.status, message: `Stopped at ${answerNow.name}: ${written.message}${notTouched(left)}`, done, failed: answer.key, untouched };
		}
		say({ key: answer.key, state: 'done', text: written.said });
		done.push(answer.key);
		if (i > 0) continue;
		// The first write is read back before anything else goes.
		const checkKey = `check:${answer.key}`;
		say({ key: checkKey, check: true, state: 'doing', text: `Checking ${answerNow.name} in Notion${left ? ` before ${others(left)}` : ''}…` });
		const checked = await written.check().catch((cause): Failure => ({ ok: false, status: 500, message: `${answerNow.name} could not be checked: ${reason(cause)}.` }));
		if (!checked.ok) {
			say({ key: checkKey, check: true, state: 'failed', text: `${checked.message}${notTouched(left)}` });
			return { ok: false, status: checked.status, message: `Stopped after ${answerNow.name}: ${checked.message}${notTouched(left)}`, done, untouched };
		}
		say({ key: checkKey, check: true, state: 'done', text: `${checked.said}${left ? ` Adding ${others(left)}.` : ''}` });
	}
	return { ok: true, done, untouched: [] };
}
