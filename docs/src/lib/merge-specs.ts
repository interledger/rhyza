import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import type { OpenAPIV3_1 } from 'openapi-types'
import { HTTP_METHODS, type HttpMethod } from './http-methods.js'

// process.cwd() is the docs/ directory both when Astro loads astro.config.mjs
// and when it prerenders pages. import.meta.url does not work for the latter,
// because Vite rebases it to the prerender chunk location.
const SPEC_DIR = resolve(process.cwd(), 'openapi')

// OpenAPIV3_1.TagObject doesn't model vendor extensions, but 'x-displayName'
// is a real, legal OpenAPI extension key that Scalar reads for sidebar labels.
interface DisplayTagObject extends OpenAPIV3_1.TagObject {
  'x-displayName'?: string
}

interface SpecConfig {
  file: string
  // Heading for this spec's group in the sidebar. The overview tag built from
  // it is also the anchor the docs sidebar links to.
  title: string
  // Prefix for any component whose name another spec already uses with
  // different content.
  componentPrefix: string
  // Tag for operations and webhooks that carry none. Scalar otherwise lists
  // them under a generic "default" group, detached from the spec they
  // belong to.
  defaultTag?: DisplayTagObject
}

// Sidebar order. Matches the order of the three specs in the docs sidebar.
const SPECS: SpecConfig[] = [
  {
    file: 'admin/admin-api.yaml',
    title: 'Admin API',
    componentPrefix: 'Admin'
  },
  {
    file: 'webhooks.yaml',
    title: 'Webhooks API',
    componentPrefix: 'Webhooks',
    defaultTag: { name: 'webhook-events', 'x-displayName': 'Webhook events' }
  },
  {
    file: 'idp-service-api.yaml',
    title: 'Identity Provider Service API',
    componentPrefix: 'Idp',
    defaultTag: { name: 'idp-service', 'x-displayName': 'Interactions' }
  }
]

type Operation = OpenAPIV3_1.OperationObject
type ComponentSections = Record<string, Record<string, unknown>>

function load(file: string): OpenAPIV3_1.Document {
  return yaml.load(
    readFileSync(resolve(SPEC_DIR, file), 'utf-8')
  ) as OpenAPIV3_1.Document
}

function overviewTagName(title: string): string {
  return `${title} overview`
}

function operationsOf(
  items: Record<string, OpenAPIV3_1.PathItemObject | undefined> | undefined
): Operation[] {
  const ops: Operation[] = []
  for (const item of Object.values(items ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method]
      if (op) ops.push(op)
    }
  }
  return ops
}

// A merged document has one document-level server list and one
// document-level security requirement, and OpenAPI applies both to every
// operation in it. The IdP service API requires a shared secret and the
// Admin API requires nothing, so each operation carries its own spec's
// values instead. The webhooks spec sets neither.
function scopeOperations(doc: OpenAPIV3_1.Document, spec: SpecConfig): void {
  for (const op of [
    ...operationsOf(doc.paths),
    ...operationsOf(doc.webhooks)
  ]) {
    if (doc.servers?.length && !op.servers) op.servers = doc.servers
    if (doc.security && !op.security) op.security = doc.security
    if (!op.tags?.length && spec.defaultTag) op.tags = [spec.defaultTag.name]
  }
}

function rewriteRefs(node: unknown, renames: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const child of node) rewriteRefs(child, renames)
    return
  }
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string' && renames.has(value)) {
      record[key] = renames.get(value)
    } else {
      rewriteRefs(value, renames)
    }
  }
}

// Every component section present in any spec is carried over, rather than a
// hand-listed few. On Open Payments, naming sections by hand missed
// `responses` and `examples`, which left their `$ref`s dangling.
//
// Two specs can use one name for different content. The Admin and IdP
// service APIs both define `Amount`, and `assetScale` is a number in one and
// an integer in the other. The later spec's copy is renamed with its prefix
// and every `$ref` in that spec follows the rename, so neither spec's
// operations silently pick up the other's schema. The title keeps the
// original name on screen.
function mergeComponents(
  docs: OpenAPIV3_1.Document[]
): OpenAPIV3_1.ComponentsObject {
  const merged: ComponentSections = {}

  docs.forEach((doc, index) => {
    const components = (doc.components ?? {}) as ComponentSections
    const renames = new Map<string, string>()

    for (const [section, entries] of Object.entries(components)) {
      for (const [name, value] of Object.entries(entries)) {
        const existing = merged[section]?.[name]
        if (
          existing === undefined ||
          JSON.stringify(existing) === JSON.stringify(value)
        ) {
          continue
        }
        const renamed = `${SPECS[index].componentPrefix}${name}`
        renames.set(
          `#/components/${section}/${name}`,
          `#/components/${section}/${renamed}`
        )
        delete entries[name]
        entries[renamed] =
          section === 'schemas' ? { title: name, ...(value as object) } : value
      }
    }

    rewriteRefs(doc, renames)

    for (const [section, entries] of Object.entries(components)) {
      merged[section] = { ...(merged[section] ?? {}), ...entries }
    }
  })

  return merged as OpenAPIV3_1.ComponentsObject
}

function mergeTags(docs: OpenAPIV3_1.Document[]): DisplayTagObject[] {
  return docs.flatMap((doc, index) => {
    const { title, defaultTag } = SPECS[index]
    const overview: DisplayTagObject = {
      name: overviewTagName(title),
      'x-displayName': title,
      description: [doc.info.description, `Version ${doc.info.version}.`]
        .filter(Boolean)
        .join('\n\n')
    }
    return [overview, ...(doc.tags ?? []), ...(defaultTag ? [defaultTag] : [])]
  })
}

// Methods on the same path combine across specs. Two specs can also define
// the same method on the same path, as two different services that happen to
// share a literal path. On a collision, both the earlier and the later spec's
// operation move to a path tagged with their own spec's title, rather than
// one spec's bare path silently winning over the other's, with a warning so
// a future collision is never silent again.
// `paths` and `webhooks` use different map types, so this takes either.
function mergePathMaps<T extends object>(
  entries: {
    spec: SpecConfig
    map: Record<string, T | undefined> | undefined
  }[]
): Record<string, T> {
  const result: Record<string, Record<string, unknown>> = {}
  const claimedPaths: Record<
    string,
    Partial<Record<HttpMethod, SpecConfig>>
  > = {}

  for (const { spec, map } of entries) {
    for (const [path, item] of Object.entries(map ?? {})) {
      const asMethodMap = (item ?? {}) as Record<HttpMethod, unknown>
      const claims = (claimedPaths[path] ??= {})

      for (const method of HTTP_METHODS) {
        const operation = asMethodMap[method]
        if (operation === undefined) continue

        const existingSpec = claims[method]
        if (existingSpec) {
          const existingPath = `${path} (${existingSpec.title})`
          if (result[path]?.[method] !== undefined) {
            result[existingPath] = {
              ...result[existingPath],
              [method]: result[path][method]
            }
            delete result[path][method]
            if (Object.keys(result[path]).length === 0) delete result[path]
          }

          const mergedPath = `${path} (${spec.title})`
          // This runs during the docs build, not in the browser; the build
          // log is where a new collision needs to surface.
          // eslint-disable-next-line no-console
          console.warn(
            `[merge-specs] ${method.toUpperCase()} ${path} is defined in more than one spec. ` +
              `${existingSpec.title}'s copy now appears at ${existingPath} and ${spec.title}'s at ${mergedPath} in the merged reference.`
          )
          result[mergedPath] = { ...result[mergedPath], [method]: operation }
        } else {
          result[path] = { ...result[path], [method]: operation }
          claims[method] = spec
        }
      }
    }
  }

  return result as Record<string, T>
}

export function mergeSpecs(): string {
  const docs = SPECS.map(({ file }) => load(file))
  docs.forEach((doc, index) => scopeOperations(doc, SPECS[index]))

  // Components first, because a rename rewrites `$ref`s inside the paths.
  const components = mergeComponents(docs)

  const merged: OpenAPIV3_1.Document = {
    openapi: '3.1.0',
    info: {
      title: 'Rhyza API',
      // The specs version independently. Each overview carries its own.
      version: docs[0].info.version,
      license: docs[0].info.license,
      description:
        'API reference for the Rhyza Admin API, Webhooks API, and Identity Provider Service API.'
    },
    // No document-level servers or security. Each operation carries its own.
    tags: mergeTags(docs),
    paths: mergePathMaps(
      docs.map((doc, index) => ({ spec: SPECS[index], map: doc.paths }))
    ),
    webhooks: mergePathMaps(
      docs.map((doc, index) => ({ spec: SPECS[index], map: doc.webhooks }))
    ),
    components
  }

  return yaml.dump(merged, { lineWidth: -1 })
}
