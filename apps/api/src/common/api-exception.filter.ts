import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiErrorBody,
  ApiErrorCode,
  FieldError,
  NotesLimitReachedException,
  PinnedNotesLimitReachedException,
  ValidationFailedException,
} from './api-error.js';

// The fixed message of each code. The message of an exception is never sent:
// the one Nest makes of a body-parser error quotes the request body.
const MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: 'Request validation failed.',
  INVALID_BODY: 'Request body must be a JSON object.',
  NOT_FOUND: 'Resource not found.',
  PAYLOAD_TOO_LARGE: 'Request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json.',
  NOTES_LIMIT_REACHED: 'The limit of stored notes is reached.',
  PINNED_NOTES_LIMIT_REACHED: 'The limit of pinned notes is reached.',
  REQUEST_FAILED: 'Request failed.',
  INTERNAL_ERROR: 'Internal server error.',
};

const CODES_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'INVALID_BODY',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
};

interface ApiErrorAnswer {
  status: number;
  body: ApiErrorBody;
}

function answer(
  status: number,
  code: ApiErrorCode,
  fields?: FieldError[],
): ApiErrorAnswer {
  const error: ApiErrorBody['error'] = { code, message: MESSAGES[code] };
  if (fields) {
    error.fields = fields.map(({ field, code }) => ({ field, code }));
  }
  return { status, body: { error } };
}

// Turns every exception of an HTTP request into the one error shape of the API
// (ADR-0003), with the codes of the API Contract in docs/specs/SMP-2/plan.md.
// Registered with APP_FILTER, it also catches the errors of the body parser and
// the 404 of an unknown path.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = this.toAnswer(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }

  private toAnswer(exception: unknown): ApiErrorAnswer {
    if (exception instanceof ValidationFailedException) {
      return answer(400, 'VALIDATION_FAILED', exception.fields);
    }
    if (exception instanceof NotesLimitReachedException) {
      return answer(HttpStatus.CONFLICT, 'NOTES_LIMIT_REACHED');
    }
    if (exception instanceof PinnedNotesLimitReachedException) {
      return answer(HttpStatus.CONFLICT, 'PINNED_NOTES_LIMIT_REACHED');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODES_BY_STATUS[status];
      if (code) {
        return answer(status, code);
      }
      if (status >= 400 && status < 500) {
        return answer(status, 'REQUEST_FAILED');
      }
    }
    this.logUnexpected(exception);
    return answer(500, 'INTERNAL_ERROR');
  }

  // Logs the name and stack only: never the request, nor a thrown value that is
  // not an Error, since either may hold what the client sent.
  private logUnexpected(exception: unknown): void {
    if (exception instanceof Error) {
      this.logger.error(exception.name, exception.stack);
    } else {
      this.logger.error(`A value of type ${typeof exception} was thrown`);
    }
  }
}
