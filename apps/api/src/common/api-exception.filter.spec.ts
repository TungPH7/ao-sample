import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter.js';
import {
  FieldError,
  NotesLimitReachedException,
  PinnedNotesLimitReachedException,
  ValidationFailedException,
} from './api-error.js';

// The request body a client sent; nothing of it may reach the answer or the log.
const BODY_MARKER = 'body-marker-7f3a9c';

interface RecordedResponse {
  statusCode?: number;
  body?: unknown;
}

// An Express-like response that records what the filter answers, inside the
// ArgumentsHost of an HTTP request to `url` whose body holds the marker.
function catchWithFilter(exception: unknown, url = '/notes'): RecordedResponse {
  const recorded: RecordedResponse = {};
  const response = {
    status(code: number) {
      recorded.statusCode = code;
      return response;
    },
    json(body: unknown) {
      recorded.body = body;
      return response;
    },
  };
  const request = {
    method: 'POST',
    url,
    originalUrl: url,
    body: { title: BODY_MARKER },
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);
  return recorded;
}

describe('ApiExceptionFilter', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ValidationFailedException', () => {
    it('answers 400 VALIDATION_FAILED with the field errors', () => {
      const fields: FieldError[] = [
        { field: 'title', code: 'TOO_LONG' },
        { field: 'content', code: 'INVALID_TYPE' },
      ];

      const answer = catchWithFilter(new ValidationFailedException(fields));

      expect(answer.statusCode).toBe(400);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          fields: [
            { field: 'title', code: 'TOO_LONG' },
            { field: 'content', code: 'INVALID_TYPE' },
          ],
        },
      });
    });

    it('copies only field and code of each field error, never a sent value', () => {
      const withValue = {
        field: 'title',
        code: 'TOO_LONG',
        value: BODY_MARKER,
      };
      const fields: FieldError[] = [withValue];

      const answer = catchWithFilter(new ValidationFailedException(fields));

      expect(answer.body).toStrictEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
          fields: [{ field: 'title', code: 'TOO_LONG' }],
        },
      });
    });

    it('is a BadRequestException that carries its fields', () => {
      const fields: FieldError[] = [{ field: 'title', code: 'REQUIRED' }];

      const exception = new ValidationFailedException(fields);

      expect(exception).toBeInstanceOf(BadRequestException);
      expect(exception.getStatus()).toBe(400);
      expect(exception.fields).toBe(fields);
    });
  });

  describe('other 400 HttpException', () => {
    it('answers 400 INVALID_BODY with the fixed message', () => {
      const answer = catchWithFilter(new BadRequestException());

      expect(answer.statusCode).toBe(400);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'INVALID_BODY',
          message: 'Request body must be a JSON object.',
        },
      });
    });

    it('never repeats the message of the exception, which may quote the request body', () => {
      // What Nest makes of a body-parser SyntaxError: the JSON.parse message,
      // which quotes part of the request body.
      const exception = new BadRequestException(
        `Unexpected token 'x', "{"title": "${BODY_MARKER}" x" is not valid JSON`,
      );

      const answer = catchWithFilter(exception);

      expect(answer.statusCode).toBe(400);
      expect(JSON.stringify(answer.body)).not.toContain(BODY_MARKER);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'INVALID_BODY',
          message: 'Request body must be a JSON object.',
        },
      });
    });

    it('never repeats an object response of the exception', () => {
      const exception = new HttpException(
        { message: BODY_MARKER, detail: BODY_MARKER },
        HttpStatus.BAD_REQUEST,
      );

      const answer = catchWithFilter(exception);

      expect(JSON.stringify(answer.body)).not.toContain(BODY_MARKER);
    });
  });

  describe('400 of a path that does not decode (AC12)', () => {
    // What Nest makes of the URIError Express throws when it decodes a path
    // param: a BadRequestException with the message of Express.
    function decodeFailure(param: string): BadRequestException {
      return new BadRequestException(`Failed to decode param '${param}'`);
    }

    it.each([
      ['%FF', 'PUT'],
      ['%C3%28', 'PUT'],
      ['%ED%A0%80', 'PUT'],
      ['%FF', 'DELETE'],
      ['%C3%28', 'DELETE'],
      ['%ED%A0%80', 'DELETE'],
    ])(
      'answers 404 NOT_FOUND for the id %s, which is not UTF-8, on %s /notes/:id/pin',
      (id) => {
        const answer = catchWithFilter(decodeFailure(id), `/notes/${id}/pin`);

        expect(answer.statusCode).toBe(404);
        expect(answer.body).toStrictEqual({
          error: { code: 'NOT_FOUND', message: 'Resource not found.' },
        });
      },
    );

    it('answers 404 NOT_FOUND for a path that does not decode whatever the message', () => {
      const answer = catchWithFilter(
        new BadRequestException(),
        '/notes/%FF/pin',
      );

      expect(answer.statusCode).toBe(404);
    });

    it('never repeats the id of the path', () => {
      const answer = catchWithFilter(decodeFailure('%FF'), '/notes/%FF/pin');

      expect(JSON.stringify(answer.body)).not.toContain('%FF');
    });

    it('does not log', () => {
      catchWithFilter(decodeFailure('%FF'), '/notes/%FF/pin');

      expect(logError).not.toHaveBeenCalled();
    });

    it.each([
      ['an id that decodes', '/notes/%C3%A9/pin'],
      ['a query that does not decode', '/notes?x=%FF'],
    ])('keeps 400 INVALID_BODY for %s', (_name, url) => {
      const answer = catchWithFilter(new BadRequestException(), url);

      expect(answer.statusCode).toBe(400);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'INVALID_BODY',
          message: 'Request body must be a JSON object.',
        },
      });
    });

    it('keeps 400 VALIDATION_FAILED for a path that does not decode', () => {
      const fields: FieldError[] = [{ field: 'title', code: 'REQUIRED' }];

      const answer = catchWithFilter(
        new ValidationFailedException(fields),
        '/notes/%FF',
      );

      expect(answer.statusCode).toBe(400);
      expect(answer.body).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it.each([
      ['413', new PayloadTooLargeException(), 413],
      ['415', new UnsupportedMediaTypeException(), 415],
    ])(
      'keeps the status of a %s on a path that does not decode',
      (_name, exception, status) => {
        const answer = catchWithFilter(exception, '/notes/%FF/pin');

        expect(answer.statusCode).toBe(status);
      },
    );
  });

  describe('404 HttpException', () => {
    it('answers 404 NOT_FOUND without the path Nest puts in the message', () => {
      const answer = catchWithFilter(
        new NotFoundException(`Cannot GET /${BODY_MARKER}`),
      );

      expect(answer.statusCode).toBe(404);
      expect(answer.body).toStrictEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found.' },
      });
    });
  });

  describe('413 HttpException', () => {
    it('answers 413 PAYLOAD_TOO_LARGE', () => {
      const answer = catchWithFilter(
        new PayloadTooLargeException('request entity too large'),
      );

      expect(answer.statusCode).toBe(413);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
        },
      });
    });
  });

  describe('NotesLimitReachedException', () => {
    it('answers 409 NOTES_LIMIT_REACHED with its fixed message', () => {
      const answer = catchWithFilter(new NotesLimitReachedException());

      expect(answer.statusCode).toBe(409);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'NOTES_LIMIT_REACHED',
          message: 'The limit of stored notes is reached.',
        },
      });
    });
  });

  describe('PinnedNotesLimitReachedException', () => {
    it('answers 409 PINNED_NOTES_LIMIT_REACHED with its fixed message', () => {
      const answer = catchWithFilter(new PinnedNotesLimitReachedException());

      expect(answer.statusCode).toBe(409);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'PINNED_NOTES_LIMIT_REACHED',
          message: 'The limit of pinned notes is reached.',
        },
      });
    });

    it('is a ConflictException', () => {
      const exception = new PinnedNotesLimitReachedException();

      expect(exception).toBeInstanceOf(ConflictException);
      expect(exception.getStatus()).toBe(409);
    });

    it('never repeats the message of the exception', () => {
      const answer = catchWithFilter(
        new PinnedNotesLimitReachedException(BODY_MARKER),
      );

      expect(JSON.stringify(answer.body)).not.toContain(BODY_MARKER);
    });

    it('does not log', () => {
      catchWithFilter(new PinnedNotesLimitReachedException());

      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('415 HttpException', () => {
    it('answers 415 UNSUPPORTED_MEDIA_TYPE', () => {
      const answer = catchWithFilter(
        new UnsupportedMediaTypeException(BODY_MARKER),
      );

      expect(answer.statusCode).toBe(415);
      expect(answer.body).toStrictEqual({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Content-Type must be application/json.',
        },
      });
    });
  });

  describe('other 4xx HttpException', () => {
    it.each([
      ['401', new UnauthorizedException(BODY_MARKER), 401],
      ['403', new ForbiddenException(BODY_MARKER), 403],
      ['405', new MethodNotAllowedException(BODY_MARKER), 405],
      ['409', new ConflictException(BODY_MARKER), 409],
      ['422', new HttpException(BODY_MARKER, 422), 422],
      ['499', new HttpException(BODY_MARKER, 499), 499],
    ])(
      'keeps the status %s and answers REQUEST_FAILED',
      (_name, exception, status) => {
        const answer = catchWithFilter(exception);

        expect(answer.statusCode).toBe(status);
        expect(answer.body).toStrictEqual({
          error: { code: 'REQUEST_FAILED', message: 'Request failed.' },
        });
      },
    );

    it('does not log a client error', () => {
      catchWithFilter(new ForbiddenException(BODY_MARKER));

      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe('anything else', () => {
    const internalError = {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
    };

    it('answers 500 INTERNAL_ERROR for a plain Error and logs its name and stack', () => {
      const exception = new TypeError(`cannot read ${BODY_MARKER}`);

      const answer = catchWithFilter(exception);

      expect(answer.statusCode).toBe(500);
      expect(answer.body).toStrictEqual(internalError);
      expect(JSON.stringify(answer.body)).not.toContain(BODY_MARKER);
      expect(logError).toHaveBeenCalledTimes(1);
      const logged = logError.mock.calls[0].join('\n');
      expect(logged).toContain('TypeError');
      expect(logged).toContain(exception.stack);
    });

    it('does not log the request body', () => {
      catchWithFilter(new Error('database is down'));

      const logged = logError.mock.calls.flat().join('\n');
      expect(logged).not.toContain(BODY_MARKER);
    });

    it.each([
      ['500', new InternalServerErrorException(BODY_MARKER)],
      ['503', new ServiceUnavailableException(BODY_MARKER)],
    ])(
      'answers 500 INTERNAL_ERROR for a %s HttpException and logs it',
      (_name, exception) => {
        const answer = catchWithFilter(exception);

        expect(answer.statusCode).toBe(500);
        expect(answer.body).toStrictEqual(internalError);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls[0].join('\n')).toContain(exception.stack);
      },
    );

    it.each([
      ['200', new HttpException('OK', 200)],
      ['302', new HttpException('Found', 302)],
    ])(
      'answers 500 INTERNAL_ERROR for a %s HttpException',
      (_name, exception) => {
        const answer = catchWithFilter(exception);

        expect(answer.statusCode).toBe(500);
        expect(answer.body).toStrictEqual(internalError);
      },
    );

    it.each([
      ['a string', BODY_MARKER],
      ['an object', { body: BODY_MARKER }],
      ['undefined', undefined],
    ])(
      'answers 500 INTERNAL_ERROR when %s is thrown, and logs no value of it',
      (_name, thrown) => {
        const answer = catchWithFilter(thrown);

        expect(answer.statusCode).toBe(500);
        expect(answer.body).toStrictEqual(internalError);
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls.flat().join('\n')).not.toContain(
          BODY_MARKER,
        );
      },
    );
  });
});
