/**
 * Mirror newly created sessions into Claude Code CLI's native history index.
 *
 * Target: $CLAUDE_CONFIG_DIR/history.jsonl (default ~/.claude/history.jsonl)
 * Verified against Claude Code CLI v1.x (which reads this file to populate
 * the "recent sessions" picker surfaced via `claude /resume`).
 *
 * Line schema (exactly one JSON object per line, newline-terminated):
 *   { "display": string,         // truncated title, ≤50 chars
 *     "pastedContents": {},      // empty object — reserved by CLI
 *     "timestamp": number,       // Date.now() ms
 *     "project": string,         // POSIX path (WSL-converted on Windows+WSL)
 *     "sessionId": string }      // UUID matching the ACP sessionId
 *
 * Invariants:
 *   - append-only, fire-and-forget; failures MUST NOT throw into caller
 *   - plugin remains source of truth; this file is a best-effort mirror
 *   - single-line atomicity relies on O_APPEND; stay well below PIPE_BUF (4 KiB)
 */

import { spawn } from "child_process";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import { Platform } from "obsidian";
import { getLogger } from "../utils/logger";
import {
	buildWslShortCommand,
	convertWindowsPathToWsl,
	escapeShellArgBash,
} from "../utils/platform";

export interface ClaudeHistoryMirrorOptions {
	sessionId: string;
	/** Pre-truncated title (≤50 chars recommended). */
	display: string;
	/** Host-OS absolute path; auto-converted to POSIX in WSL mode. */
	project: string;
	wslMode: boolean;
	wslDistribution?: string;
	/** Defaults to Date.now(). */
	timestamp?: number;
}

interface HistoryLineFields {
	display: string;
	pastedContents: Record<string, never>;
	timestamp: number;
	project: string;
	sessionId: string;
}

/**
 * Build the JSON-line payload (without trailing newline).
 * Exported for tests.
 */
export function buildHistoryLine(opts: ClaudeHistoryMirrorOptions): string {
	const fields: HistoryLineFields = {
		display: opts.display,
		pastedContents: {},
		timestamp: opts.timestamp ?? Date.now(),
		project: opts.project,
		sessionId: opts.sessionId,
	};
	return JSON.stringify(fields);
}

/**
 * Resolve the absolute path to history.jsonl.
 *
 * Honors $CLAUDE_CONFIG_DIR, falling back to ~/.claude. A relative
 * $CLAUDE_CONFIG_DIR resolves against the user's home directory (not CWD).
 *
 * Exported for tests.
 */
export function resolveClaudeHistoryPath(
	env: NodeJS.ProcessEnv,
	homedir: string,
): string {
	const override = env.CLAUDE_CONFIG_DIR;
	const configDir = override
		? path.isAbsolute(override)
			? override
			: path.resolve(homedir, override)
		: path.join(homedir, ".claude");
	return path.join(configDir, "history.jsonl");
}

/**
 * Append one JSONL entry. Never throws. Logs failures via Logger.warn
 * (gated by debugMode).
 */
export async function appendToClaudeHistory(
	opts: ClaudeHistoryMirrorOptions,
): Promise<void> {
	const logger = getLogger();

	try {
		if (Platform.isWin && opts.wslMode) {
			await writeViaWsl(opts);
		} else {
			await writeDirect(opts);
		}
	} catch (err) {
		logger.warn("[claude-history-sync] failed to append:", err);
	}
}

async function writeDirect(opts: ClaudeHistoryMirrorOptions): Promise<void> {
	const target = resolveClaudeHistoryPath(process.env, os.homedir());
	const line = buildHistoryLine(opts) + "\n";
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.appendFile(target, line, { flag: "a" });
}

async function writeViaWsl(opts: ClaudeHistoryMirrorOptions): Promise<void> {
	const wslOpts: ClaudeHistoryMirrorOptions = {
		...opts,
		project: convertWindowsPathToWsl(opts.project),
	};
	const line = buildHistoryLine(wslOpts);
	const escapedLine = escapeShellArgBash(line);

	// $HOME and $CLAUDE_CONFIG_DIR are expanded inside the WSL shell.
	// Using printf '%s\n' avoids echo's backslash-interpretation surprises.
	const posix =
		`dir="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}" && ` +
		`mkdir -p "$dir" && ` +
		`printf '%s\\n' ${escapedLine} >> "$dir/history.jsonl"`;

	const { command, args } = buildWslShortCommand(
		posix,
		opts.wslDistribution,
	);

	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { windowsHide: true });
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						`wsl.exe exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
					),
				);
			}
		});
	});
}
