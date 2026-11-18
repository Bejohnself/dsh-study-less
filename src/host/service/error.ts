/**
 * The one refusal type of the domain layer.
 *
 * It lives apart from service.ts so the operation modules can import it without a
 * cycle: service.ts depends on them, they must not depend on service.ts at runtime.
 */
/** A domain refusal with a stable machine code. */
export class StudyError extends Error {
  readonly code: 'not-found' | 'conflict' | 'invalid' | 'unsupported'
  readonly details?: unknown

  constructor(
    code: 'not-found' | 'conflict' | 'invalid' | 'unsupported',
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = 'StudyError'
    this.code = code
    this.details = details
  }
}
