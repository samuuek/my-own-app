import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

export type QueryResult<T> = {
  rows: T[];
};

export interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export class CloudDatabase implements Queryable {
  private readonly sql;

  constructor(private readonly databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    const rows = await this.sql.query(text, values);
    return { rows: rows as T[] };
  }

  async transaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T> {
    const pool = new Pool({ connectionString: this.databaseUrl });

    try {
      const client = await pool.connect();
      let transactionStarted = false;

      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const result = await work({
          query: async <Row>(text: string, values?: unknown[]): Promise<QueryResult<Row>> => {
            const queryResult = await client.query(text, values);
            return { rows: queryResult.rows as Row[] };
          },
        });

        await client.query("COMMIT");
        return result;
      } catch (error) {
        if (transactionStarted) await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pool.end();
    }
  }
}
