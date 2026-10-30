import { FastifyRequest } from 'fastify';

export function getGnapToken(request: FastifyRequest): void {
  const header = request.headers['authorization'];
  if (!header) {
    request.gnapToken = null;
    return;
  }

  const gnapToken = header.replace('GNAP ', '').trim();
  request.gnapToken = gnapToken || null;
}
