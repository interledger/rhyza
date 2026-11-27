import { Ajv, Format } from 'ajv';
import addFormats from 'ajv-formats';
import { FastifySchema } from 'fastify';

export class FastifyOpenApiValidator {
  private ajv: Ajv;
  constructor(openApiSpec: {
    components: { schemas: Record<string, object> };
  }) {
    this.ajv = new Ajv({ allErrors: false, strict: false });

    addFormats(this.ajv);

    for (const [name, schemaContent] of Object.entries(
      openApiSpec.components.schemas
    )) {
      const schema = {
        ...schemaContent,
        $id: `#/components/schemas/${name}`
      };
      this.ajv.addSchema(schema);
    }
  }

  addFormat(name: string, format: Format) {
    this.ajv.addFormat(name, format);
  }

  compile(schema: FastifySchema) {
    return this.ajv.compile(schema);
  }
}
