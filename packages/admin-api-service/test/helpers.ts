import Fastify from 'fastify';
import adminOpenApiJsonSchema from '../../../docs/json/admin-api.json';
import { FastifyOpenApiValidator } from '../src/validator.js';

export function createTestApp() {
  const app = Fastify();
  const validator = new FastifyOpenApiValidator(adminOpenApiJsonSchema);

  validator.addFormat('uint64', {
    validate: (data: string) => {
      try {
        return BigInt(data) >= BigInt(0);
      } catch {
        return false;
      }
    }
  });

  app.setValidatorCompiler(({ schema }) => validator.compile(schema));

  return app;
}
