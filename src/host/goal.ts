/**
 * Session prompting for goal orchestration.
 *
 * The study desk never creates sessions itself: a goal is delivered into the
 * conversation the user is already looking at, so the Agent there can call the
 * study tools and the user can watch the work. This module owns the minimal
 * Gateway peer + invoke shape that the Host's typed RPC surface accepts.
 */

/** The subset of the typert gateway used here. */
export interface GatewayFace {
  invoke(request: {
    namespace: string
    method: string
    args: Record<string, unknown>
    peer: OwnerPeer
    signal?: AbortSignal
  }): Promise<unknown>
}

/** The owner peer every in-process call speaks for. */
export interface OwnerPeer {
  id: string
  ctx: unknown
  principal: { kind: 'owner' }
  signal: AbortSignal
  interactions: 'none'
  dispose(): Promise<void>
}

/** Create the plugin's owner peer. */
export function createOwnerPeer(ctx: unknown): OwnerPeer {
  const controller = new AbortController()
  let done: Promise<void> | undefined
  return {
    id: `study-desk-owner:${crypto.randomUUID()}`,
    ctx,
    principal: { kind: 'owner' },
    signal: controller.signal,
    interactions: 'none',
    dispose() {
      if (done === undefined) {
        controller.abort()
        done = Promise.resolve()
      }
      return done
    },
  }
}

/**
 * Queue one user message into an existing session.
 * @param gateway - the Host gateway service.
 * @param peer - owner peer.
 * @param sessionId - target conversation.
 * @param text - the instruction.
 */
export async function promptSession(
  gateway: GatewayFace,
  peer: OwnerPeer,
  sessionId: string,
  text: string,
): Promise<void> {
  await gateway.invoke({
    namespace: 'session',
    method: 'prompt',
    args: {
      request: {
        sessionId,
        requestId: `study-goal-${crypto.randomUUID()}`,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
    },
    peer,
  })
}
