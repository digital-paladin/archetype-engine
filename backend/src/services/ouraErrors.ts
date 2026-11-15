export type OuraErrorCode =
  | 'not_configured'
  | 'not_connected'
  | 'revoked'
  | 'rate_limited'
  | 'forbidden'
  | 'storage'
  | 'bad_request'
  | 'upstream';

/** Safe to show to the signed-in user and to write in logs. Never includes tokens. */
export class OuraError extends Error {
  readonly safeMessage: string;

  constructor(
    safeMessage: string,
    readonly httpStatus: number,
    readonly code: OuraErrorCode,
  ) {
    super(safeMessage);
    this.name = 'OuraError';
    this.safeMessage = safeMessage;
  }
}
