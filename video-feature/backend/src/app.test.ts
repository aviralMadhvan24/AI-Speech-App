import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

describe('health check', () => {
  it('GET /health responds 200 with status ok (confirms the backend boots)', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('mock-interview-mvp');
  });
});
