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

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
