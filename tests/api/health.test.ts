import { describe, it, expect } from 'vitest';
import { GET } from '../../src/app/api/health/route';

describe('Health API Route', () => {
  it('should return 200 status code and { status: "ok" } payload', async () => {
    const response = await GET();
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data).toEqual({ status: 'ok' });
  });
});
