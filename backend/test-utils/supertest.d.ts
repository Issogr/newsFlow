declare module 'supertest' {
  import type { Application } from 'express';

  function request(app: Application): request.SuperTest;

  namespace request {
    interface ApiResponseBody {
      access: { mode: string; cachedOnly?: boolean };
      apiToken: unknown;
      customSources: unknown[];
      error: { code: string; message: string };
      features: {
        ai: Record<string, boolean>;
        publicApi: { anonymousEnabled: boolean; authenticatedEnabled: boolean };
      };
      limits: Record<string, unknown>;
      readSummaryIds: string[];
      settings: Record<string, unknown>;
      setupLink: string;
      source: { id: string; name: string };
      summary: Record<string, unknown>;
      token: string;
      user: { id: string; username: string; isAdmin: boolean };
      users: unknown[];
    }

    interface Response {
      body: ApiResponseBody;
      headers: Record<string, string | string[] | undefined>;
      status: number;
    }

    interface Test extends PromiseLike<Response> {
      attach(field: string, file: Buffer, options: { filename: string; contentType: string }): this;
      expect(status: number, body?: unknown): this;
      field(name: string, value: string): this;
      query(value: Record<string, string>): this;
      send(value: unknown): this;
      set(name: string, value: string): this;
    }

    interface SuperTest {
      delete(url: string): Test;
      get(url: string): Test;
      patch(url: string): Test;
      post(url: string): Test;
    }
  }

  export = request;
}
