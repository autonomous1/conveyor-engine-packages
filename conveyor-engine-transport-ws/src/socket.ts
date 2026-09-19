export type SocketHandler = (text: string) => void;

/** Minimal duplex used by the adapter. Live `ws` sockets wrap this. */
export interface TransportSocket {
  send(text: string): void;
  close(): void;
  onMessage(handler: SocketHandler): void;
  onClose(handler: () => void): void;
}

export function memoryPair(): { server: TransportSocket; client: TransportSocket } {
  const serverHandlers: SocketHandler[] = [];
  const clientHandlers: SocketHandler[] = [];
  const serverClose: Array<() => void> = [];
  const clientClose: Array<() => void> = [];
  let open = true;

  const server: TransportSocket = {
    send(text) {
      if (!open) return;
      for (const h of clientHandlers) h(text);
    },
    close() {
      if (!open) return;
      open = false;
      for (const h of serverClose) h();
      for (const h of clientClose) h();
    },
    onMessage(handler) {
      serverHandlers.push(handler);
    },
    onClose(handler) {
      serverClose.push(handler);
    },
  };
  const client: TransportSocket = {
    send(text) {
      if (!open) return;
      for (const h of serverHandlers) h(text);
    },
    close() {
      if (!open) return;
      open = false;
      for (const h of serverClose) h();
      for (const h of clientClose) h();
    },
    onMessage(handler) {
      clientHandlers.push(handler);
    },
    onClose(handler) {
      clientClose.push(handler);
    },
  };
  return { server, client };
}
