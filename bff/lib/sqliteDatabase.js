const { DatabaseSync } = require('node:sqlite');

function toPlainValue(value) {
  return value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value;
}

function toPlainObject(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return row;
  }

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toPlainValue(value)]));
}

function toDatabaseOptions(options = {}) {
  return {
    readOnly: Boolean(options.readonly || options.readOnly),
    timeout: typeof options.timeout === 'number' ? options.timeout : 5000
  };
}

class SqliteStatement {
  constructor(statement) {
    this.statement = statement;
  }

  run(...params) {
    return toPlainObject(this.statement.run(...params));
  }

  get(...params) {
    return toPlainObject(this.statement.get(...params));
  }

  all(...params) {
    return this.statement.all(...params).map(toPlainObject);
  }
}

class SqliteDatabase {
  constructor(filename, options = {}) {
    this.database = new DatabaseSync(filename, toDatabaseOptions(options));
    this.closed = false;
  }

  prepare(sql) {
    return new SqliteStatement(this.database.prepare(sql));
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  pragma(sql) {
    const statement = sql.trim().toLowerCase().startsWith('pragma') ? sql : `PRAGMA ${sql}`;
    return this.prepare(statement).all();
  }

  close() {
    if (this.closed) {
      return undefined;
    }

    this.closed = true;
    return this.database.close();
  }
}

module.exports = SqliteDatabase;
