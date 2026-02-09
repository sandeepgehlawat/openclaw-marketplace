import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { WsEventType } from "../../config/constants.js";
import { Job, serializeJob } from "../../models/job.js";

interface WsClient {
  ws: WebSocket;
  wallet?: string;
  subscriptions: Set<WsEventType>;
}

interface WsMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  events?: WsEventType[];
  wallet?: string;
}

interface WsEvent {
  type: WsEventType;
  data: object;
  timestamp: string;
}

export class WebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, WsClient> = new Map();

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("WebSocket client connected");

      // Register client with default subscriptions
      const client: WsClient = {
        ws,
        subscriptions: new Set([
          WsEventType.JOB_NEW,
          WsEventType.JOB_CLAIMED,
          WsEventType.JOB_COMPLETED,
        ]),
      };
      this.clients.set(ws, client);

      // Send welcome message
      ws.send(
        JSON.stringify({
          type: "connected",
          message: "Connected to OpenClaw Marketplace",
          subscriptions: Array.from(client.subscriptions),
        })
      );

      // Handle messages
      ws.on("message", (data: Buffer) => {
        try {
          const message: WsMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          ws.send(JSON.stringify({ error: "Invalid message format" }));
        }
      });

      // Handle close
      ws.on("close", () => {
        console.log("WebSocket client disconnected");
        this.clients.delete(ws);
      });

      // Handle errors
      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.clients.delete(ws);
      });
    });

    console.log("WebSocket hub initialized");
  }

  private handleMessage(ws: WebSocket, message: WsMessage): void {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case "subscribe":
        if (message.events) {
          message.events.forEach((event) => client.subscriptions.add(event));
        }
        if (message.wallet) {
          client.wallet = message.wallet;
        }
        ws.send(
          JSON.stringify({
            type: "subscribed",
            subscriptions: Array.from(client.subscriptions),
            wallet: client.wallet,
          })
        );
        break;

      case "unsubscribe":
        if (message.events) {
          message.events.forEach((event) => client.subscriptions.delete(event));
        }
        ws.send(
          JSON.stringify({
            type: "unsubscribed",
            subscriptions: Array.from(client.subscriptions),
          })
        );
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        break;

      default:
        ws.send(JSON.stringify({ error: "Unknown message type" }));
    }
  }

  broadcast(eventType: WsEventType, data: object): void {
    const event: WsEvent = {
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    const message = JSON.stringify(event);

    for (const [ws, client] of this.clients) {
      if (client.subscriptions.has(eventType)) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  }

  // Convenience methods for job events
  broadcastJobNew(job: Job): void {
    this.broadcast(WsEventType.JOB_NEW, serializeJob(job));
  }

  broadcastJobClaimed(job: Job): void {
    this.broadcast(WsEventType.JOB_CLAIMED, serializeJob(job));
  }

  broadcastJobCompleted(job: Job): void {
    this.broadcast(WsEventType.JOB_COMPLETED, serializeJob(job));
  }

  broadcastJobPaid(job: Job): void {
    this.broadcast(WsEventType.JOB_PAID, serializeJob(job));
  }

  // Notify specific wallet
  notifyWallet(wallet: string, eventType: WsEventType, data: object): void {
    const event: WsEvent = {
      type: eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    const message = JSON.stringify(event);

    for (const [ws, client] of this.clients) {
      if (client.wallet === wallet && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  getConnectedCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
export const wsHub = new WebSocketHub();
