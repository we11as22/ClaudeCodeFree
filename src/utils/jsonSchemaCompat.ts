type JsonSchemaObject = Record<string, unknown>

const OPENAI_SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
])

function isObject(value: unknown): value is JsonSchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(clone)
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
    )
  }
  return value
}

function flattenTopLevelComposition(schema: JsonSchemaObject): JsonSchemaObject {
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : undefined
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : undefined
  const composition = anyOf ?? oneOf ?? allOf
  if (!composition || composition.length === 0) {
    return schema
  }

  const { anyOf: _anyOf, oneOf: _oneOf, allOf: _allOf, ...rest } = schema
  const objectVariant = composition.find(
    variant =>
      isObject(variant) &&
      (variant.type === 'object' || isObject(variant.properties)),
  )

  if (isObject(objectVariant)) {
    return {
      ...rest,
      ...objectVariant,
    }
  }

  return {
    ...rest,
    type: 'object',
    properties: {},
    additionalProperties: false,
  }
}

function normalizeInner(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(normalizeInner)
  }
  if (!isObject(schema)) {
    return schema
  }

  const flattened = flattenTopLevelComposition(schema)
  const result: JsonSchemaObject = {}
  const rawType = flattened.type

  if (Array.isArray(rawType)) {
    result.anyOf = rawType.map(typeValue => {
      const variant: JsonSchemaObject = { type: typeValue }
      if (typeValue === 'array' && 'items' in flattened) {
        variant.items = normalizeInner(flattened.items)
      }
      return variant
    })
  } else if (rawType !== undefined) {
    result.type = rawType
  }

  for (const [key, value] of Object.entries(flattened)) {
    if (key === 'type') {
      continue
    }
    if (key === 'format') {
      if (typeof value === 'string' && OPENAI_SUPPORTED_FORMATS.has(value)) {
        result.format = value
      }
      continue
    }
    if (key === 'properties' && isObject(value)) {
      const normalizedProperties: JsonSchemaObject = {}
      for (const [propName, propSchema] of Object.entries(value)) {
        normalizedProperties[propName] = normalizeInner(propSchema)
      }
      result.properties = normalizedProperties
      continue
    }
    if (key === 'items') {
      result.items = normalizeInner(value)
      continue
    }
    if (
      (key === 'anyOf' || key === 'oneOf' || key === 'allOf') &&
      Array.isArray(value)
    ) {
      result[key] = value.map(normalizeInner)
      continue
    }
    result[key] = clone(value)
  }

  const properties =
    isObject(result.properties) ? (result.properties as JsonSchemaObject) : null
  const isObjectType =
    result.type === 'object' ||
    (Array.isArray(result.anyOf) &&
      result.anyOf.some(
        variant => isObject(variant) && variant.type === 'object',
      )) ||
    properties !== null

  if (properties) {
    const propertyKeys = new Set(Object.keys(properties))
    const required = Array.isArray(result.required)
      ? result.required.filter(
          entry => typeof entry === 'string' && propertyKeys.has(entry),
        )
      : undefined
    result.required = required ?? []
  } else if (isObjectType) {
    result.properties = {}
    result.required = []
  }

  if (isObjectType) {
    result.additionalProperties = false
  } else {
    delete result.additionalProperties
  }

  return result
}

export function normalizeToolSchema<T = unknown>(schema: T): T {
  return normalizeInner(schema) as T
}
