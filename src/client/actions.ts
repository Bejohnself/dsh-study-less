/**
 * Host-navigation actions the study desk needs from the shell.
 *
 * The shell owns the conversation and the panel selection, so the plugin only
 * records the faces it was given at activation and calls them from the UI.
 */

let lookupSession: (() => string | undefined) | undefined
let selectConversation: (() => void) | undefined

/** Install the shell faces captured at activation. */
export function installActions(faces: {
  session?: () => string | undefined
  conversation?: () => void
}): void {
  lookupSession = faces.session
  selectConversation = faces.conversation
}

/** The session the main view currently shows, when the shell exposes it. */
export function currentSessionId(): string | undefined {
  try {
    return lookupSession?.()
  } catch {
    return undefined
  }
}

/** Switch the center column back to the conversation. */
export function openConversation(): void {
  try {
    selectConversation?.()
  } catch {
    // Navigation is best effort: a shell without the face leaves the panel open.
  }
}
