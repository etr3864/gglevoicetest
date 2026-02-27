import { Response } from 'express';
import { createLogger } from '../../lib/logger';

const log = createLogger('sse-manager');

class SSEManager {
  private clients = new Map<string, Set<Response>>();
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    // Send heartbeat every 15 seconds to keep connections alive through proxies/load balancers
    this.heartbeatInterval = setInterval(() => this.broadcastHeartbeat(), 15000);
  }

  addClient(agentId: string, res: Response): void {
    if (!this.clients.has(agentId)) {
      this.clients.set(agentId, new Set());
    }
    this.clients.get(agentId)!.add(res);

    res.on('close', () => {
      this.removeClient(agentId, res);
    });
  }

  removeClient(agentId: string, res: Response): void {
    const agentClients = this.clients.get(agentId);
    if (agentClients) {
      agentClients.delete(res);
      if (agentClients.size === 0) {
        this.clients.delete(agentId);
      }
    }
  }

  broadcastToAgent(agentId: string, event: string, data: unknown): void {
    const agentClients = this.clients.get(agentId);
    if (!agentClients) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of agentClients) {
      res.write(payload);
    }
  }

  private broadcastHeartbeat(): void {
    for (const agentClients of this.clients.values()) {
      for (const res of agentClients) {
        res.write(': heartbeat\n\n');
      }
    }
  }

  shutdown(): void {
    clearInterval(this.heartbeatInterval);
    for (const agentClients of this.clients.values()) {
      for (const res of agentClients) {
        res.end();
      }
    }
    this.clients.clear();
    log.info('SSE Manager shutdown complete');
  }
}

export const sseManager = new SSEManager();
