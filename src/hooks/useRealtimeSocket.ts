import { useCallback, useEffect, useRef, useState } from 'react';

export interface SocketNotification {
  type: 'report:created' | 'report:status_updated' | 'report:upvoted';
  reportId: string;
  ticketId: string;
  status?: string;
  category?: string;
  actorName?: string;
  timestamp: string;
}

export function useRealtimeSocket(onEvent?: (event: SocketNotification) => void) {
  const [connected, setConnected] = useState(false);
  const [activeUsers, setActiveUsers] = useState<number>(1);
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as
            | { type: 'presence:count'; activeUsers: number }
            | SocketNotification;
          if (data.type === 'presence:count') {
            setActiveUsers(Math.max(1, data.activeUsers));
          } else if (
            data.type === 'report:created' ||
            data.type === 'report:status_updated' ||
            data.type === 'report:upvoted'
          ) {
            onEventRef.current?.(data);
          }
        } catch {
          // Ignore invalid socket frame
        }
      };

      socket.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!disposed) {
          const delay = Math.min(10000, 1000 * Math.pow(1.6, attempt));
          attempt += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const broadcast = useCallback((event: Omit<SocketNotification, 'timestamp'>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...event, timestamp: new Date().toISOString() }));
    }
  }, []);

  return { connected, activeUsers, broadcast };
}
