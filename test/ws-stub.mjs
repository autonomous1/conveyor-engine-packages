export class WebSocket {
  static OPEN = 1;
  readyState = 1;
  on() {}
  send() {}
  close() {}
}

export class WebSocketServer {
  on() {}
  close() {}
}

export default { WebSocket, WebSocketServer };
