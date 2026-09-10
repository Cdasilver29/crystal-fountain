/**
 * Domain errors.
 *
 * Services throw these. They carry a stable machine readable code and the HTTP
 * status a route handler should map them to, but they know nothing about
 * Request or Response, so the domain stays portable.
 */
export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export const notFound = (code: string, message: string) =>
  new ServiceError(code, message, 404);

export const conflict = (code: string, message: string) =>
  new ServiceError(code, message, 409);

/** The request was understood and refused. A failed bot check lands here. */
export const rejected = (code: string, message: string) =>
  new ServiceError(code, message, 422);

/** Too many of the same thing, too fast. */
export const tooManyRequests = (code: string, message: string) =>
  new ServiceError(code, message, 429);

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
