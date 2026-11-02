import { BadRequestException } from '@nestjs/common';

// The one shape of every error the API answers (ADR-0003). The codes and their
// fixed messages are in the API Contract of docs/specs/SMP-2/plan.md; adding a
// code is additive, renaming or removing one is a breaking change.
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_BODY'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'REQUEST_FAILED'
  | 'INTERNAL_ERROR';

// A machine-readable error of one request field. It never holds the value sent.
export interface FieldError {
  field: string;
  code: string;
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; fields?: FieldError[] };
}

// Thrown when the request body breaks the rules of its endpoint; the filter
// answers it as 400 VALIDATION_FAILED with these fields.
export class ValidationFailedException extends BadRequestException {
  constructor(readonly fields: FieldError[]) {
    super();
  }
}
