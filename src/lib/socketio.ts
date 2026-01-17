/**
 * Socket.IO 協議工具
 */

import { ParsedMessage } from "./types";

export const NAMESPACE = "/participant";
export const TEACHER_NAMESPACE = "/teacher";

/**
 * 編碼 Socket.IO 事件
 */
export function encodeEvent(
  namespace: string,
  eventName: string,
  data: unknown
): string {
  return `42${namespace},${JSON.stringify([eventName, data])}`;
}

/**
 * 連線到 namespace
 */
export function encodeConnect(
  namespace: string,
  auth: Record<string, unknown> = {}
): string {
  return `40${namespace},${JSON.stringify(auth)}`;
}

/**
 * 解析 Socket.IO 訊息
 */
export function parseMessage(msg: string): ParsedMessage | null {
  if (!msg) return null;
  if (msg === "2") return { type: "ping" };
  if (msg === "3") return { type: "pong" };

  // Engine.IO open packet
  if (msg.startsWith("0")) {
    try {
      return { type: "open", data: JSON.parse(msg.slice(1)) };
    } catch {
      return { type: "open", data: {} };
    }
  }

  // Socket.IO connect (namespace join)
  if (msg.startsWith("40")) {
    const rest = msg.slice(2);
    let ns = "/";
    let data: Record<string, unknown> = {};

    if (rest.startsWith("/")) {
      const commaIdx = rest.indexOf(",");
      if (commaIdx > 0) {
        ns = rest.slice(0, commaIdx);
        try {
          data = JSON.parse(rest.slice(commaIdx + 1));
        } catch {
          // ignore parse error
        }
      } else {
        ns = rest;
      }
    } else if (rest) {
      try {
        data = JSON.parse(rest);
      } catch {
        // ignore parse error
      }
    }
    return { type: "connect", namespace: ns, data };
  }

  // Socket.IO event
  if (msg.startsWith("42")) {
    const rest = msg.slice(2);
    let ns = "/";
    let payload = rest;

    if (rest.startsWith("/")) {
      const commaIdx = rest.indexOf(",");
      if (commaIdx > 0) {
        ns = rest.slice(0, commaIdx);
        payload = rest.slice(commaIdx + 1);
      }
    }

    // 處理 callback ID
    const bracketIdx = payload.indexOf("[");
    if (bracketIdx > 0) payload = payload.slice(bracketIdx);

    try {
      const arr = JSON.parse(payload) as [string, unknown];
      return {
        type: "event",
        namespace: ns,
        event: arr[0],
        data: arr[1] as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 產生 UUID
 */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
