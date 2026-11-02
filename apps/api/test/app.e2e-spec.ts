import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('GET /health answers 200 with the status', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  describe('error shape', () => {
    it('GET /nope answers 404 NOT_FOUND as JSON', async () => {
      const response = await request(app.getHttpServer()).get('/nope');

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toStrictEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found.' },
      });
    });

    it('POST /health with malformed JSON answers 400 INVALID_BODY without quoting the body', async () => {
      // JSON.parse quotes part of this body in its message:
      // Unexpected token 'b', ..."{"title": body-marke"... is not valid JSON
      const sent = '{"title": body-marker-7f3a9c}';

      const response = await request(app.getHttpServer())
        .post('/health')
        .set('Content-Type', 'application/json')
        .send(sent);

      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toStrictEqual({
        error: {
          code: 'INVALID_BODY',
          message: 'Request body must be a JSON object.',
        },
      });
      expect(response.text).not.toContain('body-marke');
    });

    it('a body of 110 kB answers 413 PAYLOAD_TOO_LARGE', async () => {
      const sent = JSON.stringify({ title: 'x'.repeat(110 * 1024) });

      const response = await request(app.getHttpServer())
        .post('/health')
        .set('Content-Type', 'application/json')
        .send(sent);

      expect(response.status).toBe(413);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toStrictEqual({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
        },
      });
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
