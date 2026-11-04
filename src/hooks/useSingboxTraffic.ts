import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useIslandStore } from "../store/useIslandStore";

export function useSingboxTraffic() {
  const vpnConnected = useIslandStore((s) => s.vpnConnected);
  const setVpnMetrics = useIslandStore((s) => s.setVpnMetrics);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!vpnConnected) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setVpnMetrics({ upBytes: 0, downBytes: 0, pingMs: 0 });
      return;
    }

    function connect() {
      try {
        const ws = new WebSocket("ws://127.0.0.1:9090/traffic");
        wsRef.current = ws;

        ws.onopen = () => {
          // Connected to clash API
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // Clash traffic format: { up: 1234, down: 5678 } in bytes/s
            setVpnMetrics({
              upBytes: data.up || 0,
              downBytes: data.down || 0,
            });
          } catch {
            // Ignore parse errors
          }
        };

        ws.onerror = () => {
          ws.close();
        };

        ws.onclose = () => {
          if (vpnConnected) {
            reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
          }
        };
      } catch {
        if (vpnConnected) {
          reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
        }
      }
    }

    connect();

    // Ping check loop (works with both Xray and sing-box via local proxy check or Clash API)
    const pingInterval = window.setInterval(async () => {
      if (!vpnConnected) return;
      try {
        // 1. First try Tauri native proxy delay measurement (universal for Xray and sing-box)
        const delay = await invoke<number>("vpn_check_delay");
        if (typeof delay === "number" && delay > 0) {
          setVpnMetrics({ pingMs: delay });
          return;
        }
      } catch {
        // Fall back to Clash API if sing-box is running with clash_api
        try {
          const testUrl = "http://127.0.0.1:9090/proxies/proxy/delay?timeout=2500&url=http%3A%2F%2Fcp.cloudflare.com%2Fgenerate_204";
          const delayRes = await fetch(testUrl, { signal: AbortSignal.timeout(3000) });
          if (delayRes.ok) {
            const delayData = await delayRes.json();
            if (delayData.delay && delayData.delay > 0) {
              setVpnMetrics({ pingMs: delayData.delay });
              return;
            }
          }
        } catch {
          // Both checks unavailable momentarily
        }
      }
    }, 4000);

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      clearInterval(pingInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [vpnConnected, setVpnMetrics]);
}
