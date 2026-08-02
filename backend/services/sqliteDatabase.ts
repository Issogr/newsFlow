import { DatabaseSync } from 'node:sqlite';
import type { DatabaseSyncOptions, SQLInputValue, StatementResultingChanges, StatementSync } from 'node:sqlite';
import type { DynamicRecord } from '../utils/types';

function toPlainValue(value: unknown) {
  return value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value;
}

function toPlainObject<T>(row: T): T {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return row;
  }

  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toPlainValue(value)])) as T;
}

class SqliteStatement<Row extends DynamicRecord = DynamicRecord> {
  statement: StatementSync;

  constructor(statement: StatementSync) {
    this.statement = statement;
  }

  run(...params: unknown[]): StatementResultingChanges {
    return toPlainObject(this.statement.run(...params as SQLInputValue[]));
  }

  get(...params: unknown[]): Row | undefined {
    return toPlainObject(this.statement.get(...params as SQLInputValue[])) as Row | undefined;
  }

  all(...params: unknown[]): Row[] {
    return this.statement.all(...params as SQLInputValue[]).map(toPlainObject) as Row[];
  }
}

class SqliteDatabase {
  database: DatabaseSync;
  transactionDepth: number;
  closed: boolean;

  constructor(filename: string, { timeout = 5000, ...options }: DatabaseSyncOptions = {}) {
    this.database = new DatabaseSync(filename, { ...options, timeout });
    this.transactionDepth = 0;
    this.closed = false;
  }

  prepare<Row extends DynamicRecord = DynamicRecord>(sql: string) {
    return new SqliteStatement<Row>(this.database.prepare(sql));
  }

  exec(sql: string) {
    return this.database.exec(sql);
  }

  pragma(sql: string) {
    const statement = sql.trim().toLowerCase().startsWith('pragma') ? sql : `PRAGMA ${sql}`;
    return this.prepare(statement).all();
  }

  transaction<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
    return (...args: Args): Result => {
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

export = SqliteDatabase;
