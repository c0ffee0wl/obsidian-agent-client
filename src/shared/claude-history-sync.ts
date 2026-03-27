/**
 * Append a session entry to Claude Code's native history.jsonl.
 *
 * This makes sessions started via obsidian-agent-client visible in
 * external history viewers like claude-run.
 *
 * On Windows+WSL: writes via \\wsl$\Debian\home\devuser\.claude\history.jsonl
 * On Linux/macOS: writes to ~/.claude/history.jsonl directly
 *
 * Fire-and-forget — errors are logged but never thrown.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Platform } from "obsidian";
import { convertWindowsPathToWsl } from "./wsl-utils";

const WSL_HISTORY_PATH =
	"\\\\wsl$\\Debian\\home\\devuser\\.claude\\history.jsonl";

/**
 * Get the path to Claude Code's history.jsonl file.
 */
function getClaudeHistoryPath(isWslMode: boolean): string {
	if (Platform.isWin && isWslMode) {
		return WSL_HISTORY_PATH;
	}

	const claudeDir =
		process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
	return path.join(claudeDir, "history.jsonl");
}

/**
 * Append a session entry to history.jsonl.
 *
 * @param sessionId - UUID of the session
 * @param display - First user message text (used as title in claude-run)
 * @param project - Working directory (raw Windows or Linux path)
 * @param isWslMode - Whether the plugin is in WSL mode
 */
export function appendToClaudeHistory(
	sessionId: string,
	display: string,
	project: string,
	isWslMode: boolean,
): void {
	try {
		const historyPath = getClaudeHistoryPath(isWslMode);

		// Convert project path to WSL format when in WSL mode
		const wslProject =
			Platform.isWin && isWslMode
				? convertWindowsPathToWsl(project)
				: project;

		const entry = JSON.stringify({
			display,
			pastedContents: {},
			timestamp: Date.now(),
			project: wslProject,
			sessionId,
		});

		fs.appendFile(historyPath, entry + "\n", { encoding: "utf-8" }, (err) => {
			if (err) {
				console.warn(
					"[claude-history-sync] Failed to append to history.jsonl:",
					err.message,
				);
			}
		});
	} catch (err) {
		console.warn("[claude-history-sync] Error:", err);
	}
}
