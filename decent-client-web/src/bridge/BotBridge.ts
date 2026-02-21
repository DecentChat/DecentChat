/**
 * BotBridge — connects to the OpenClaw decent-openclaw plugin.
 * Forwards user messages to OpenClaw AI, receives replies.
 */

export type BotMessage = {
  inReplyToId: string;
  channelId: string;
  content: string;
  timestamp: number;
};

export type BotTypingEvent = {
  channelId: string;
  messageId: string;
};

export type BotCommandAck = {
  channelId: string;
  text: string;
};

export interface BotBridgeConfig {
  /** Full WebSocket URL, e.g. ws://192.168.1.100:4242 or wss://bridge.example.com */
  url?: string;
  /** Kept for backward-compat; ignored if url is set */
  port?: number;
  secret?: string;
  enabled?: boolean;
}

export class BotBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 500;
  private maxDelay = 30_000;
  private stopped = false;
  private config: Required<Pick<BotBridgeConfig, "port">> & BotBridgeConfig;

  private onReplyCallbacks: Array<(msg: BotMessage) => void> = [];
  private onTypingCallbacks: Array<(evt: BotTypingEvent) => void> = [];
  private onCommandAckCallbacks: Array<(ack: BotCommandAck) => void> = [];
  private onStatusCallbacks: Array<(connected: boolean) => void> = [];

  constructor(config: BotBridgeConfig = {}) {
    this.config = { port: 4242, url: "ws://localhost:4242", ...config };
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (!this.config.enabled) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnect();
    this.ws?.close();
    this.ws = null;
  }

  reconfigure(config: BotBridgeConfig): void {
    const wasEnabled = this.config.enabled;
    this.config = { port: 4242, url: "ws://localhost:4242", ...config };

    if (this.config.enabled && !wasEnabled) {
      this.start();
    } else if (!this.config.enabled && wasEnabled) {
      this.stop();
    } else if (this.config.enabled) {
      this.ws?.close();
    }
  }

  onReply(cb: (msg: BotMessage) => void): void {
    this.onReplyCallbacks.push(cb);
  }

  onTyping(cb: (evt: BotTypingEvent) => void): void {
    this.onTypingCallbacks.push(cb);
  }

  onCommandAck(cb: (ack: BotCommandAck) => void): void {
    this.onCommandAckCallbacks.push(cb);
  }

  onStatus(cb: (connected: boolean) => void): void {
    this.onStatusCallbacks.push(cb);
  }

  sendMessage(params: {
    messageId: string;
    channelId: string;
    workspaceId: string;
    senderId: string;
    senderName: string;
    content: string;
    chatType: "channel" | "direct";
    timestamp?: number;
    replyToId?: string;
  }): void {
    if (!this.isConnected || !this.ws) {
      return;
    }

    this.ws.send(JSON.stringify({ type: "message", timestamp: Date.now(), ...params }));
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    const url = this.config.url ?? `ws://localhost:${this.config.port ?? 4242}`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 500;
      if (this.config.secret && this.ws) {
        this.ws.send(JSON.stringify({ type: "auth", secret: this.config.secret }));
      }
      this.notifyStatus(true);
    };

    this.ws.onclose = () => {
      this.notifyStatus(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose follows onerror in typical browser websocket behavior
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string);
        switch (msg.type) {
          case "reply":
            this.onReplyCallbacks.forEach((cb) => cb(msg as BotMessage));
            break;
          case "typing":
            this.onTypingCallbacks.forEach((cb) => cb(msg as BotTypingEvent));
            break;
          case "command_ack":
            this.onCommandAckCallbacks.forEach((cb) => cb(msg as BotCommandAck));
            break;
          case "ping":
            this.ws?.send(JSON.stringify({ type: "pong" }));
            break;
          default:
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyStatus(connected: boolean): void {
    this.onStatusCallbacks.forEach((cb) => cb(connected));
  }
}
