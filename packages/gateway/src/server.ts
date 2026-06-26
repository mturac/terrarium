import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { loadPersistedWorld, loadRunningWorld } from '@terrarium/core';
import { createFintechVertical } from '@terrarium/vertical-fintech';
import {
  handleTransferCreate,
  type StripeTransferRequest,
  type StripeTransferResponse,
} from './routes.js';

export interface GatewayOptions {
  cwd: string;
  port?: number;
  host?: string;
}

export interface GatewayHandle {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function createGateway(options: GatewayOptions): Promise<GatewayHandle> {
  const cwd = options.cwd;
  const host = options.host ?? '127.0.0.1';

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, cwd);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind gateway'));
        return;
      }
      const port = addr.port;
      resolve({
        server,
        port,
        url: `http://${host}:${port}`,
        close: () =>
          new Promise((res, rej) => {
            server.close((e) => (e ? rej(e) : res()));
          }),
      });
    });
  });
}

async function route(req: IncomingMessage, res: ServerResponse, cwd: string): Promise<void> {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0] ?? '/';

  if (method === 'GET' && path === '/v1/health') {
    sendJson(res, 200, { status: 'ok', service: 'terrarium-gateway' });
    return;
  }

  if (method === 'GET' && path === '/v1/status') {
    const world = loadPersistedWorld(cwd);
    if (!world) {
      sendJson(res, 404, { error: 'No running world. Run terrarium up fintech first.' });
      return;
    }
    sendJson(res, 200, {
      run_id: world.meta.run_id,
      vertical: world.meta.vertical,
      seed: world.meta.seed,
      clock_tick: world.clock_tick,
      events: world.events.length,
      state_hash: world.meta.state_hash,
    });
    return;
  }

  if (method === 'POST' && path === '/v1/transfers') {
    const world = loadPersistedWorld(cwd);
    if (!world) {
      sendJson(res, 404, { error: 'No running world. Run terrarium up fintech first.' });
      return;
    }

    const body = (await readJson(req)) as StripeTransferRequest;
    validateTransferBody(body);
    const request = withIdempotencyHeader(req, body);

    const vertical = createFintechVertical();
    const running = loadRunningWorld(cwd, vertical);
    const response: StripeTransferResponse = handleTransferCreate(running, request, cwd);
    sendJson(res, 201, response);
    return;
  }

  sendJson(res, 404, { error: `Not found: ${method} ${path}` });
}

/** Stripe sends idempotency via header; body field remains supported for tests. */
function withIdempotencyHeader(
  req: IncomingMessage,
  body: StripeTransferRequest,
): StripeTransferRequest {
  const header = req.headers['idempotency-key'];
  if (typeof header === 'string' && header.length > 0) {
    return { ...body, idempotency_key: header };
  }
  return body;
}

function validateTransferBody(body: StripeTransferRequest): void {
  if (!body || typeof body.amount !== 'number' || body.amount <= 0) {
    throw new Error('Invalid amount');
  }
  if (!body.source || !body.destination) {
    throw new Error('source and destination are required');
  }
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}