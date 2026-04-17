/**
 * Mirror newly created sessions into Claude Code CLI's native history index.
 *
 * Target: <claudeHistoryDirectory>/history.jsonl — the directory is a
 * required plugin setting. Claude Code CLI reads this file to populate
 * the "recent sessions" picker surfaced via `claude /resume`.
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

import { promises as fsp } from "fs";
import * as path from "path";
import { Platform } from "obsidian";
import { getLogger } from "../utils/logger";
import { convertWindowsPathToWsl } from "../utils/platform";

export interface ClaudeHistoryMirrorOptions {
	sessionId: string;
	/** Pre-truncated title (≤50 chars recommended). */
	display: string;
	/** Host-OS absolute path; auto-converted to POSIX in WSL mode. */
	project: string;
	/** Absolute directory that holds history.jsonl. */
	historyDirectory: string;
	/** Only affects the `project` field (POSIX conversion), not the write path. */
	wslMode: boolean;
	/** Defaults to Date.now(). */
	timestamp?: number;
}

/** Outcome of a mirror attempt. */
export type ClaudeHistoryWriteResult =
	| { ok: true; path: string }
	| { ok: false; error: string };

/**
 * Build the JSON-line payload (without trailing newline).
 * Exported for tests.
 */
export function buildHistoryLine(opts: ClaudeHistoryMirrorOptions): string {
	const project =
		Platform.isWin && opts.wslMode
			? convertWindowsPathToWsl(opts.project)
			: opts.project;
	return JSON.stringify({
		display: opts.display,
		pastedContents: {},
		timestamp: opts.timestamp ?? Date.now(),
		project,
		sessionId: opts.sessionId,
	});
}

/**
 * Append one JSONL entry. Never throws; returns a structured result.
 * `historyDirectory` must be non-empty — we don't guess at $HOME /
 * $CLAUDE_CONFIG_DIR because that was brittle across user shells.
 */
export async function appendToClaudeHistory(
	opts: ClaudeHistoryMirrorOptions,
): Promise<ClaudeHistoryWriteResult> {
	const dir = opts.historyDirectory.trim();
	if (!dir) {
		return {
			ok: false,
			error: "Claude history directory not configured",
		};
	}
	const target = path.join(dir, "history.jsonl");
	try {
		await fsp.mkdir(dir, { recursive: true });
		await fsp.appendFile(target, buildHistoryLine(opts) + "\n", {
			flag: "a",
		});
		return { ok: true, path: target };
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		getLogger().warn("[claude-history-sync] failed to append:", err);
		return { ok: false, error };
	}
}
