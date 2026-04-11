# Agent Client Plugin - LLM Developer Guide

## Overview
Obsidian plugin for AI agent interaction (Claude Code, Codex, Gemini CLI, custom agents) via ACP.

**Tech**: React 19, TypeScript, Obsidian API, Agent Client Protocol (ACP)

**Package manager**: Bun. Use `bun install`, `bun run dev`, `bun run build` — not npm.

## Architecture

```
src/
├── types/                       # Type definitions (no logic, no dependencies)
│   ├── chat.ts                  # ChatMessage, MessageContent, PromptContent, AttachedFile, ActivePermission
│   ├── session.ts               # ChatSession, SessionUpdate (12-type union), SessionInfo, Capabilities
│   ├── agent.ts                 # AgentConfig, agent settings (Claude/Codex/Gemini/Custom)
│   └── errors.ts                # AcpError, ProcessError, ErrorInfo
├── acp/                         # ACP protocol (SDK dependency confined here)
│   ├── acp-client.ts            # Process lifecycle, UI-facing API (AcpClient class)
│   ├── acp-handler.ts           # SDK event handler + sessionId filter + listener broadcast
│   ├── type-converter.ts        # ACP SDK ↔ internal type conversion
│   ├── permission-handler.ts    # Permission queue, auto-approve, Promise resolution
│   └── terminal-handler.ts      # Terminal process create/output/kill
├── services/                    # Business logic (non-React, no React imports)
│   ├── vault-service.ts         # Vault access + fuzzy search + CM6 selection tracking
│   ├── settings-service.ts      # Reactive settings store (observer pattern only)
│   ├── session-storage.ts       # Session metadata + message file I/O (sessions/*.json)
│   ├── settings-normalizer.ts   # Settings validation helpers (str, bool, num, enumVal, etc.)
│   ├── session-helpers.ts       # Agent config building, API key injection (pure functions)
│   ├── session-state.ts         # Session state updates (legacy mode/model, config restore)
│   ├── message-state.ts         # Message array transforms (upsert, merge, streaming apply)
│   ├── message-sender.ts        # Prompt preparation + sending (pure functions)
│   ├── chat-exporter.ts         # Markdown export with frontmatter
│   └── view-registry.ts         # Multi-view management, focus, broadcast
├── hooks/                       # React custom hooks (state + logic)
│   ├── useAgent.ts              # Facade: composes useAgentSession + useAgentMessages
│   ├── useAgentSession.ts       # Session lifecycle, config options, optimistic updates
│   ├── useAgentMessages.ts      # Message state, streaming (RAF batch), permissions
│   ├── useSuggestions.ts        # @[[note]] mentions + /command suggestions (unified)
│   ├── useSessionHistory.ts     # Session list/load/resume/fork
│   ├── useChatActions.ts        # Business callbacks (send, newChat, export, restart, etc.)
│   ├── useHistoryModal.ts       # Session history modal lifecycle
│   └── useSettings.ts           # Settings subscription (useSyncExternalStore)
├── ui/                          # React components
│   ├── ChatContext.ts           # React Context (plugin, acpClient, vaultService, settingsService)
│   ├── ChatPanel.tsx            # Orchestrator: calls hooks, workspace events, rendering
│   ├── ChatView.tsx             # Sidebar view (ItemView wrapper)
│   ├── FloatingChatView.tsx     # Floating window (position/drag/resize)
│   ├── ChatHeader.tsx           # Header (sidebar + floating variants)
│   ├── MessageList.tsx          # Virtualized message list (@tanstack/react-virtual)
│   ├── MessageBubble.tsx        # Single message rendering (content dispatch, copy button)
│   ├── ToolCallBlock.tsx        # Tool call + diff display (word-level highlighting)
│   ├── TerminalBlock.tsx        # Terminal output polling
│   ├── InputArea.tsx            # Textarea, attachments, mentions, history
│   ├── InputToolbar.tsx         # Config/mode/model selectors, usage, send button
│   ├── SuggestionPopup.tsx      # Mention/command dropdown
│   ├── PermissionBanner.tsx     # Permission request buttons
│   ├── ErrorBanner.tsx          # Error/notification overlay
│   ├── SessionHistoryModal.tsx  # Session history modal (list + confirm delete)
│   ├── FloatingButton.tsx       # Draggable launch button
│   ├── SettingsTab.ts           # Plugin settings UI
│   ├── view-host.ts             # IChatViewHost interface
│   └── shared/
│       ├── IconButton.tsx       # Icon button + Lucide icon wrapper
│       ├── MarkdownRenderer.tsx # Obsidian markdown rendering
│       └── AttachmentStrip.tsx  # Attachment preview strip
├── utils/                       # Shared utilities (pure functions)
│   ├── platform.ts              # Shell, WSL, Windows env, command building
│   ├── paths.ts                 # Path resolution, file:// URI
│   ├── error-utils.ts           # ACP error conversion
│   ├── mention-parser.ts        # @[[note]] detection/extraction
│   └── logger.ts                # Debug-mode logger
├── plugin.ts                    # Obsidian plugin lifecycle, settings persistence
└── main.ts                      # Entry point
```

## Data Flow

### ACP Event Flow (single path)
```
Agent Process → ACP SDK → AcpHandler (sessionId filter) → listeners broadcast
  → useAgentSession (session-level: commands, mode, config, usage, error)
  → useAgentMessages (message-level: text chunks, tool calls, plan)
  → useAgent (facade, 1 onSessionUpdate subscription)
```

All events flow through a single `onSessionUpdate` channel. No special paths for permissions or errors.

### Permission Flow
```
Agent requestPermission → PermissionManager.request() → onSessionUpdate (tool_call)
User clicks approve/reject → PermissionManager.respond() → onSessionUpdate (tool_call_update)
```

## Key Components

### ChatPanel (`ui/ChatPanel.tsx`)
Central orchestrator component.
- **Hook Composition**: Calls useAgent, useSuggestions, useSessionHistory, useChatActions, useHistoryModal, useSettings
- **Workspace Events**: Handles hotkeys via ref pattern (stable event registration)
- **Callback Registration**: IChatViewContainer callbacks via refs
- **Rendering**: Renders ChatHeader, MessageList, InputArea directly

ChatPanel does NOT route session updates — that's handled internally by useAgent.

### ChatView / FloatingChatView (`ui/ChatView.tsx`, `ui/FloatingChatView.tsx`)
Thin wrappers that:
- Create services (AcpClient, VaultService) in lifecycle methods
- Provide ChatContext (plugin, acpClient, vaultService, settingsService)
- Render `<ChatPanel variant="sidebar" | "floating" />`
- Implement IChatViewContainer for broadcast commands

FloatingChatView uses `onRegisterExpanded` callback (not CustomEvent) for expand/collapse.

### Hooks (`hooks/`)

**useAgent** (facade): Comp훈oses useAgentSession + useAgentMessages
- Single `onSessionUpdate` subscription
- Unified `handleSessionUpdate` dispatches to both sub-hooks
- Return is `useMemo`-wrapped for referential stability

**useAgentSession**: Session lifecycle + config
- `createSession()`: Build config, inject API keys, initialize + newSession
- `setConfigOption()`: Optimistic update + rollback on error
- `setMode()` / `setModel()`: Legacy API (deprecated, still used by many agents)
- Session-level update handler (commands, mode, config, usage, process_error)
- Uses `sessionRef` pattern to stabilize callback deps

**useAgentMessages**: Messaging + streaming + permissions
- `sendMessage()`: Prepare (auto-mention, path conversion) → send via AcpClient
- RAF batching: streaming updates accumulated per-frame via `requestAnimationFrame`
- Tool call index: `Map<string, number>` for O(1) upsert
- `ignoreUpdatesRef`: suppresses history replay during session/load
- Permission: `activePermission` (useMemo derivation), approve/reject callbacks

**useSuggestions**: @mention + /command (unified)
- Mention detection, note searching, dropdown interaction
- Slash command filtering and selection
- Auto-mention toggle coordination (slash commands disable auto-mention)
- Return is `useMemo`-wrapped (mentions + commands objects)

**useChatActions**: Business callbacks
- handleSendMessage, handleNewChat, handleExportChat, handleRestartAgent, etc.
- Uses individual method deps (not whole agent object) for stability
- Owns restoredMessage state

**useSessionHistory**: Session persistence
- `restoreSession()`: Load/resume with local message fallback
- `forkSession()`: Create new branch from existing session
- 5-minute cache with invalidation
- Return is `useMemo`-wrapped

**useHistoryModal**: Modal lifecycle
- Lazy modal creation, props synchronization
- Session operation callbacks (restore, fork, delete)

### ACP Client (`acp/acp-client.ts`) + ACP Handler (`acp/acp-handler.ts`)

**AcpClient** — UI-facing API and process lifecycle:
- spawn() with login shell, JSON-RPC via ndJsonStream
- initialize() → newSession() → sendPrompt() → cancel() → disconnect()
- Session management: listSessions, loadSession, resumeSession, forkSession
- Owns PermissionManager, TerminalManager, AcpHandler
- `currentSessionId` set before `await` in loadSession/resumeSession to prevent replay filtering
- Single exit point: `onSessionUpdate` (multiple listeners via Set)

**AcpHandler** — SDK event receiver:
- sessionUpdate: converts ACP types → domain types → broadcast to listeners
- sessionId filter: only emits updates matching `currentSessionId`
- requestPermission → PermissionManager
- Terminal operations → TerminalManager

### Services (`services/`)

**VaultService**: Vault access + file index + fuzzy search + CM6 selection tracking
**SettingsService**: Reactive settings store (observer pattern for useSyncExternalStore). Session storage delegated to SessionStorage.
**SessionStorage**: Session metadata CRUD (in plugin settings) + message file I/O (sessions/*.json)
**settings-normalizer**: Validation helpers (str, bool, num, enumVal, obj, strRecord, xyPoint) + toAgentConfig + parseChatFontSize
**session-helpers**: Pure functions — buildAgentConfigWithApiKey, findAgentSettings, getAvailableAgents
**session-state**: Pure functions — applyLegacyValue, tryRestoreConfigOption, restoreLegacyConfig
**message-state**: Pure functions — applySingleUpdate, applyUpsertToolCall, mergeToolCallContent, findActivePermission, selectOption
**message-sender**: Pure functions — preparePrompt (embedded context vs XML text, shared helpers), sendPreparedPrompt (auth retry)

## Types

### SessionUpdate (`types/session.ts`)
Union type for all session update events from the agent:

```typescript
type SessionUpdate =
  | AgentMessageChunk        // Text chunk from agent's response
  | AgentThoughtChunk        // Text chunk from agent's reasoning
  | UserMessageChunk         // Text chunk from user message (session/load)
  | ToolCall                 // New tool call event
  | ToolCallUpdate           // Update to existing tool call
  | Plan                     // Agent's task plan
  | AvailableCommandsUpdate  // Slash commands changed
  | CurrentModeUpdate        // Mode changed
  | SessionInfoUpdate        // Session metadata changed
  | UsageUpdate              // Context window usage
  | ConfigOptionUpdate       // Config options changed
  | ProcessErrorUpdate;      // Process-level error (spawn failure, command not found)
```

### Key Interfaces

```typescript
// services/vault-service.ts
interface IVaultAccess {
  readNote(path: string): Promise<string>;
  searchNotes(query: string): Promise<NoteMetadata[]>;
  getActiveNote(): Promise<NoteMetadata | null>;
  listNotes(): Promise<NoteMetadata[]>;
}

// services/settings-service.ts
interface ISettingsAccess {
  getSnapshot(): AgentClientPluginSettings;
  updateSettings(updates: Partial<AgentClientPluginSettings>): Promise<void>;
  subscribe(listener: () => void): () => void;
  // Session storage methods (delegated to SessionStorage internally)
  saveSession(info: SavedSessionInfo): Promise<void>;
  getSavedSessions(agentId?: string, cwd?: string): SavedSessionInfo[];
  deleteSession(sessionId: string): Promise<void>;
  saveSessionMessages(sessionId: string, agentId: string, messages: ChatMessage[]): Promise<void>;
  loadSessionMessages(sessionId: string): Promise<ChatMessage[] | null>;
  deleteSessionMessages(sessionId: string): Promise<void>;
}
```

## Development Rules

### Architecture
1. **useAgent as facade**: Composes useAgentSession + useAgentMessages. ChatPanel calls useAgent, not sub-hooks directly.
2. **Services have zero React imports**: Pure functions and classes in `services/`. No useState, useCallback, React.Dispatch, etc.
3. **ACP isolation**: All `@agentclientprotocol/sdk` imports confined to `acp/`. AcpClient is UI-facing, AcpHandler is SDK-facing.
4. **Types have zero deps**: No `obsidian`, no SDK, no React in `types/`
5. **Single event channel**: All agent events (messages, session updates, permissions, errors) flow through `onSessionUpdate`. No special callback paths.
6. **Context for services**: plugin, acpClient, vaultService, settingsService via ChatContext

### Performance Patterns
1. **useMemo for return stability**: useAgent, useSuggestions, useSessionHistory wrap return objects in useMemo to prevent cascading re-renders
2. **sessionRef pattern**: useAgentSession stores session in useRef for callback access without adding session to deps
3. **Individual method deps**: useChatActions uses `agent.sendMessage` not `agent` as deps — prevents callback recreation when unrelated state changes
4. **Workspace event refs**: ChatPanel stores event handler callbacks in refs, keeping useEffect deps minimal
5. **RAF batching**: useAgentMessages batches streaming updates per animation frame (~60fps) instead of per-chunk
6. **React.memo**: MessageBubble, ToolCallBlock, TerminalBlock wrapped for skip-render optimization
7. **Virtual scroll**: MessageList uses @tanstack/react-virtual for large conversations
8. **O(1) tool call index**: Map<string, number> for tool call upsert without linear scan

### Obsidian Plugin Review (CRITICAL)
1. No innerHTML/outerHTML - use createEl/createDiv/createSpan
2. NO detach leaves in onunload (antipattern)
3. Styles in CSS only - no JS style manipulation
4. Use Platform interface - not process.platform
5. Minimize `any` - use proper types

### Naming Conventions
- Types: `kebab-case.ts` in `types/`
- ACP: `kebab-case.ts` in `acp/`
- Services: `kebab-case.ts` in `services/`
- Hooks: `use*.ts` in `hooks/`
- Components: `PascalCase.tsx` in `ui/`
- Utils: `kebab-case.ts` in `utils/`

### Code Patterns
1. React hooks for state management
2. useCallback/useMemo for performance (see Performance Patterns above)
3. useRef for cleanup function access and stale closure prevention
4. Error handling: try-catch async ops
5. Logging: Logger class (respects debugMode). Avoid excessive per-keystroke logging.
6. **Upsert pattern**: Use `setMessages` functional updates to avoid race conditions with tool_call updates
7. **Ref pattern for callbacks**: IChatViewContainer and workspace event handlers use refs for latest values
8. **Context value stability**: ChatContext value created once (service instances), wrapped in useMemo
9. **Stable empty arrays**: Use module-level constants (e.g., `EMPTY_COMMANDS`) instead of inline `[]` in hook args

## Common Tasks

### Add New Feature Hook
1. Create `hooks/use[Feature].ts`
2. Define state with useState/useReducer
3. Export functions and state
4. Call the hook in `ui/ChatPanel.tsx`
5. Pass state/callbacks to child components as props
6. Wrap return object in `useMemo` if passed as dependency to other hooks

### Add Agent Type
1. Add settings type in `types/agent.ts`
2. Add config and defaults in `plugin.ts`
3. Add API key injection in `services/session-helpers.ts`
4. Update `ui/SettingsTab.ts` for configuration UI

### Modify Message Types
1. Update `ChatMessage`/`MessageContent` in `types/chat.ts`
2. If adding new session update type:
   - Add to `SessionUpdate` union in `types/session.ts`
   - Handle in `hooks/useAgentMessages.ts` (for message-level) or `hooks/useAgentSession.ts` (for session-level)
3. Update `acp/acp-handler.ts` `sessionUpdate()` to emit the new type
4. Update `ui/MessageBubble.tsx` `ContentBlock` to render new type

### Add New Session Update Type
1. Define interface in `types/session.ts`
2. Add to `SessionUpdate` union type
3. Handle in `hooks/useAgentSession.ts` `handleSessionUpdate()` (for session-level)
4. Or handle via `applySingleUpdate()` in `services/message-state.ts` (for message-level)
5. No routing needed in ChatPanel — useAgent handles dispatch internally

### Debug
1. Settings → Developer Settings → Debug Mode ON
2. Open DevTools (Cmd+Option+I / Ctrl+Shift+I)
3. Filter logs: `[AcpClient]`, `[AcpHandler]`, `[PermissionManager]`, `[VaultService]`

## ACP Protocol

**Communication**: JSON-RPC 2.0 over stdin/stdout

**Methods**: initialize, newSession, authenticate, prompt, cancel, setSessionConfigOption
**Notifications**: session/update (agent_message_chunk, agent_thought_chunk, user_message_chunk, tool_call, tool_call_update, plan, available_commands_update, current_mode_update, session_info_update, usage_update, config_option_update)
**Requests**: requestPermission
**Session Management** (unstable): session/list, session/load, session/resume, session/fork

**Agents**:
- Claude Code: `@agentclientprotocol/claude-agent-acp` (ANTHROPIC_API_KEY)
- Codex: `@zed-industries/codex-acp` (OPENAI_API_KEY)
- Gemini CLI: `@google/gemini-cli` (GEMINI_API_KEY)
- Custom: Any ACP-compatible agent

---

**Last Updated**: April 2026 | **Architecture**: useAgent facade + sub-hooks | **Version**: 0.10.0-preview.1
