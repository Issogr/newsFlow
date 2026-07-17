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
  constructor(filename, { timeout = 5000, ...options } = {}) {
    this.database = new DatabaseSync(filename, { ...options, timeout });
    this.transactionDepth = 0;
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

  transaction(callback) {
    return (...args) => {
      const depth = this.transactionDepth;
      const savepoint = `newsflow_tx_${depth}`;

      this.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;

      try {
        const result = callback(...args);
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        if (depth === 0) {
          this.exec('ROLLBACK');
        } else {
          this.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    };
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
