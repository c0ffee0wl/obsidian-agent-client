/**
 * Append a session entry to Claude Code's native history.jsonl.
 *
 * Mirrors sessions started via this plugin into Claude Code's own
 * session index so `claude /resume` and other external viewers can
 * see them.
 *
 * Platform behavior:
 * - macOS / Linux / Windows-native: writes directly to
 *   `$CLAUDE_CONFIG_DIR/history.jsonl` (default `~/.claude/history.jsonl`).
 * - Windows + WSL mode: pipes the entry to `wsl.exe` so that `$HOME`
 *   and `$CLAUDE_CONFIG_DIR` are resolved inside WSL (no hardcoded
 *   distro or username).
 *
 * Fire-and-forget — failures are logged via console.warn and never thrown.
 * Caller is expected to gate on agent identity (this file does not).
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Platform } from "obsidian";
import {
	convertWindowsPathToWsl,
	WSL_DISTRO_NAME_RE,
} from "../utils/platform";

const LOG_PREFIX = "[claude-history-sync]";
const CLAUDE_DIR_NAME = ".claude";
const HISTORY_FILE_NAME = "history.jsonl";

/**
 * Lifetime-scoped caches for the direct (non-WSL) write path.
 * `CLAUDE_CONFIG_DIR` and the user's home directory don't change during
 * a plugin session, so resolve and create the directory once.
 */
let cachedClaudeDirDirect: string | null = null;
let directDirEnsured = false;

/**
 * WSL configuration snapshot passed from the caller.
 * Kept as a plain object so the service has no dependency on plugin settings.
 */
export interface ClaudeHistoryWslConfig {
	/** Whether WSL mode is active (only relevant on Windows) */
	enabled: boolean;
	/** Specific WSL distribution, or undefined to use the system default */
	distribution?: string;
}

/**
 * Append a session entry to Claude Code's `history.jsonl`.
 *
 * @param sessionId - UUID of the session (used by Claude Code `/resume` as the index key)
 * @param display - Short title / first-message preview — shown by `/resume` and external viewers
 * @param project - Working directory (raw Windows or POSIX path); converted to WSL form in WSL mode
 * @param wsl - WSL mode + optional distribution
 */
export function appendToClaudeHistory(
	sessionId: string,
	display: string,
	project: string,
	wsl: ClaudeHistoryWslConfig,
): void {
	const useWsl = Platform.isWin && wsl.enabled;

	// Validate the WSL distribution up front so we bail before building
	// the entry on a misconfigured distro name. wrapCommandForWsl throws
	// on the same condition because it guards the main agent spawn; this
	// sync is best-effort and must not crash session creation, so we warn
	// and bail instead.
	if (
		useWsl &&
		wsl.distribution &&
		!WSL_DISTRO_NAME_RE.test(wsl.distribution)
	) {
		console.warn(
			`${LOG_PREFIX} invalid WSL distribution name, skipping sync: ${wsl.distribution}`,
		);
		return;
	}

	// Project paths in history.jsonl are expected in POSIX form.
	const projectForEntry = useWsl
		? convertWindowsPathToWsl(project)
		: project;

	const entry =
		JSON.stringify({
			display,
			pastedContents: {},
			timestamp: Date.now(),
			project: projectForEntry,
			sessionId,
		}) + "\n";

	if (useWsl) {
		writeViaWsl(entry, wsl.distribution);
	} else {
		writeDirect(entry);
	}
}

/**
 * Resolve the Claude config dir for direct writes.
 *
 * Honors `$CLAUDE_CONFIG_DIR` when set, falling back to `~/.claude`.
 * A relative env value is resolved against the user's home directory —
 * NOT against Obsidian's CWD, which is platform-dependent and would
 * land the file in an unexpected location.
 *
 * Cached after the first call for the plugin lifetime.
 */
function resolveClaudeDirDirect(): string {
	if (cachedClaudeDirDirect !== null) return cachedClaudeDirDirect;
	const raw = process.env.CLAUDE_CONFIG_DIR;
	if (raw && raw.length > 0) {
		cachedClaudeDirDirect = path.isAbsolute(raw)
			? raw
			: path.resolve(os.homedir(), raw);
	} else {
		cachedClaudeDirDirect = path.join(os.homedir(), CLAUDE_DIR_NAME);
	}
	return cachedClaudeDirDirect;
}

/**
 * Write directly to `$CLAUDE_CONFIG_DIR/history.jsonl` (or `~/.claude/...`).
 * Used on macOS, Linux, and Windows-native.
 */
function writeDirect(entry: string): void {
	const claudeDir = resolveClaudeDirDirect();
	const historyPath = path.join(claudeDir, HISTORY_FILE_NAME);

	// Skip mkdir after the first successful run — the directory doesn't
	// vanish during a plugin lifetime.
	const ensureDir = directDirEnsured
		? Promise.resolve()
		: fs.promises.mkdir(claudeDir, { recursive: true }).then(() => {
				directDirEnsured = true;
			});

	ensureDir
		.then(() => fs.promises.appendFile(historyPath, entry, "utf-8"))
		.catch((err) => {
			console.warn(`${LOG_PREFIX} append failed (${historyPath}):`, err);
		});
}

/**
 * Pipe the entry to `wsl.exe`, letting WSL resolve `$HOME` and
 * `$CLAUDE_CONFIG_DIR` on its side. The shell script honors a
 * `$CLAUDE_CONFIG_DIR` set inside WSL, falling back to `$HOME/.claude`.
 *
 * Avoids hardcoding any distro or username and reuses the system's WSL setup.
 */
function writeViaWsl(entry: string, distribution: string | undefined): void {
	// Distribution name has already been validated by appendToClaudeHistory.
	const shellScript =
		'd="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" && mkdir -p "$d" && cat >> "$d/history.jsonl"';
	const args: string[] = [];
	if (distribution) {
		args.push("-d", distribution);
	}
	args.push("sh", "-c", shellScript);

	const child = spawn("wsl.exe", args, {
		stdio: ["pipe", "ignore", "ignore"],
		windowsHide: true,
	});

	// CRITICAL: attach error listeners BEFORE writing to stdin.
	// An unhandled 'error' event (e.g. wsl.exe missing → ENOENT) would crash Node.
	child.on("error", (err) => {
		console.warn(`${LOG_PREFIX} wsl.exe failed:`, err);
	});
	child.on("close", (code) => {
		if (code !== 0 && code !== null) {
			console.warn(
				`${LOG_PREFIX} wsl.exe exited with code ${code}`,
			);
		}
	});
	if (child.stdin) {
		child.stdin.on("error", (err) => {
			console.warn(`${LOG_PREFIX} stdin error:`, err);
		});
		child.stdin.end(entry, "utf-8");
	}
}
