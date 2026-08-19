export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export function createTableInAttachedSchema(schema: string, name: string, sql: string): string {
  const definitionStart = sql.indexOf('(')
  if (definitionStart < 0 || !/^CREATE\s+TABLE\b/iu.test(sql)) {
    throw new Error(`Unsupported table definition in consistent snapshot: ${name}`)
  }
  return `CREATE TABLE ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)} ${sql.slice(definitionStart)}`
}

export function createIndexInAttachedSchema(schema: string, name: string, sql: string): string {
  const onPosition = sql.search(/\sON\s/iu)
  if (onPosition < 0 || !/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(sql)) {
    throw new Error(`Unsupported index definition in consistent snapshot: ${name}`)
  }
  const prefix = /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(sql) ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'
  return `${prefix} ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}${sql.slice(onPosition)}`
}

export function createTriggerInAttachedSchema(schema: string, name: string, sql: string): string {
  const timingPosition = sql.search(/\s(?:BEFORE|AFTER|INSTEAD\s+OF)\s/iu)
  if (timingPosition < 0 || !/^CREATE\s+TRIGGER\b/iu.test(sql)) {
    throw new Error(`Unsupported trigger definition in consistent snapshot: ${name}`)
  }
  return `CREATE TRIGGER ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}${sql.slice(timingPosition)}`
}
