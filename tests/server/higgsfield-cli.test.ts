import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliRunner, GeneratorError } from '../../src/lib/server/higgsfield';

/** Stand-in CLIs are shell scripts, so these run where /bin/sh does. */
const dir = mkdtempSync(join(tmpdir(), 'hf-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function standIn(name: string, body: string): string {
	const path = join(dir, name);
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe.skipIf(process.platform === 'win32')('cliRunner', () => {
	test('a CLI that reads stdin before answering still returns, because stdin is closed', async () => {
		// Like the Higgsfield CLI: it waits for stdin to end, then prints its answer.
		const bin = standIn('reads-stdin', `cat > /dev/null\necho '{"credits": 2}'`);
		const started = Date.now();
		expect(await cliRunner(bin, 5_000)(['generate', 'cost'])).toEqual({ credits: 2 });
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	test('the CLI gets the arguments as given, plus --json --no-color', async () => {
		const bin = standIn('echo-args', `printf '['; sep=''; for a in "$@"; do printf '%s"%s"' "$sep" "$a"; sep=','; done; printf ']'`);
		expect(await cliRunner(bin, 5_000)(['generate', 'cost', 'x y'])).toEqual(['generate', 'cost', 'x y', '--json', '--no-color']);
	});

	test('a missing CLI is reported, not thrown past the caller', async () => {
		const error: unknown = await cliRunner(join(dir, 'no-such-cli'), 5_000)(['generate', 'cost']).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GeneratorError);
	});

	test('a call that hangs is killed at its timeout and reported', async () => {
		const pidFile = join(dir, 'hang.pid');
		const bin = standIn('hangs', `echo $$ > '${pidFile}'\nexec sleep 30`);
		const started = Date.now();
		const error: unknown = await cliRunner(bin, 1_000)(['generate', 'cost']).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GeneratorError);
		expect((error as GeneratorError).message).toContain('timed out after 1 s');
		expect(Date.now() - started).toBeLessThan(5_000);
		expect(existsSync(pidFile)).toBe(true);
		expect(alive(Number(readFileSync(pidFile, 'utf8').trim()))).toBe(false);
	});
});
