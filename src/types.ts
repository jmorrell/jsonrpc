// JSON-RPC 2.0 wire format types

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown[];
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Client transport abstraction — takes serialized JSON body, returns serialized JSON response
export type RpcTransport = (body: string) => Promise<string>;

// Client type helpers

type Promisify<T> = T extends (...args: any[]) => Promise<any>
  ? T
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : T;

export type PromisifyMethods<T extends object> = {
  [K in keyof T]: Promisify<T[K]>;
};

export type RpcClientOptions =
  | string
  | ((RpcFetchOptions | { transport: RpcTransport }) & {
      getHeaders?: never;
    })
  | (RpcFetchOptions & { transport?: never });

export type RpcFetchOptions = {
  url: string;
  getHeaders?():
    | Record<string, string>
    | Promise<Record<string, string>>
    | undefined;
};

// Client proxy type: promisified methods only
export type RpcClient<T extends object> = PromisifyMethods<T>;

// Server types

export type RpcHandlerOptions = {
  onError?: (err: unknown) => void;
};
