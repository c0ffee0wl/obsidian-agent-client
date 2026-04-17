import * as React from "react";
const { useEffect } = React;
import { setIcon } from "obsidian";
import type { ErrorInfo } from "../types/errors";
import { LucideIcon } from "./shared/IconButton";
import type { IChatViewHost } from "./view-host";

export interface ErrorBannerProps {
	/** Error information to display */
	errorInfo: ErrorInfo;
	/** Callback to close/clear the error */
	onClose: () => void;
	/** Whether to show emojis */
	showEmojis: boolean;
	/** View instance for event registration */
	view: IChatViewHost;
}

/**
 * Banner component displayed above the input field.
 *
 * Design decisions:
 * - Uses same positioning pattern as SuggestionPopup (position: absolute; bottom: 100%)
 * - Closes on Escape key or close button
 * - Does not block chat messages from being visible
 */
export function ErrorBanner({
	errorInfo,
	onClose,
	showEmojis,
	view,
}: ErrorBannerProps) {
	// Handle Escape key to close
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
				event.preventDefault();
			}
		};

		view.registerDomEvent(document, "keydown", handleKeyDown);
	}, [onClose, view]);

	return (
		<div className="agent-client-error-overlay agent-client-error-overlay--error">
			<div className="agent-client-error-overlay-header">
				<h4 className="agent-client-error-overlay-title">
					{errorInfo.title}
				</h4>
				<button
					className="agent-client-error-overlay-close"
					onClick={onClose}
					aria-label="Close"
					type="button"
					ref={(el) => {
						if (el) {
							setIcon(el, "x");
						}
					}}
				/>
			</div>
			<p className="agent-client-error-overlay-message">
				{errorInfo.message}
			</p>
			{errorInfo.suggestion && (
				<div className="agent-client-error-overlay-suggestion">
					{showEmojis && (
						<LucideIcon
							name="circle-alert"
							className="agent-client-error-overlay-suggestion-icon"
						/>
					)}
					{errorInfo.suggestion}
				</div>
			)}
		</div>
	);
}
