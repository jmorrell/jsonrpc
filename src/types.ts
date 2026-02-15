// pattern: Functional Core
// JSON-RPC 2.0 wire format types

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown[];
};

export type JsonRpcSuccessResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
};

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

// Protocol error codes for onError callbacks
export type RpcProtocolErrorCode =
  | "PARSE_ERROR"           // malformed JSON on transport
  | "INVALID_MESSAGE"       // non-object message received
  | "UNROUTABLE_MESSAGE"    // message is neither request nor response
  | "INVALID_RESPONSE"      // response fails structural validation
  | "NULL_RESPONSE_ID"      // response has null/undefined ID
  | "UNKNOWN_RESPONSE_ID"   // no pending call for response ID
  | "NOTIFICATION_RECEIVED" // unsupported notification received
  | "HANDLER_ERROR"         // service method threw
  | "SEND_FAILED";          // transport.send threw

export class RpcProtocolError extends Error {
  readonly code: RpcProtocolErrorCode;

  constructor(code: RpcProtocolErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RpcProtocolError";
    this.code = code;
    Object.setPrototypeOf(this, RpcProtocolError.prototype);
  }
}

// Server types

export type RpcHandlerOptions = {
  onError?: (err: RpcProtocolError) => void;
};

// Message-oriented transport for bidirectional connections
export type RpcMessageTransport = {
  send(message: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: (reason?: Error) => void): void;
  close(): void;
};

// Session types
export type RpcSessionOptions = {
  role?: 'initiator' | 'acceptor'; // default: 'initiator'
  onError?: (err: RpcProtocolError) => void;
};

export type RpcSession<TRemote extends object, TLocal extends object> = {
  remote: PromisifyMethods<TRemote>;
  close(): void;
};
