/**
 * 共用配置模組
 */

import { Config } from "./types";

// K6 環境變數
declare const __ENV: Record<string, string | undefined>;

export const NUM_ROOMS: number = parseInt(__ENV.NUM_ROOMS || "0", 10);
export const STUDENTS_PER_ROOM: number = parseInt(
  __ENV.STUDENTS_PER_ROOM || "50",
  10
);
export const VUS_PER_ROOM: number = STUDENTS_PER_ROOM + 1;
export const TOTAL_VUS: number = NUM_ROOMS * VUS_PER_ROOM;

export const CONFIG: Config = {
  // API 設定
  API_URL: __ENV.API_URL || "http://localhost:8000",
  SOCKET_URL: __ENV.SOCKET_URL || __ENV.API_URL || "http://localhost:8000",

  // 認證
  TEACHER_TOKEN: __ENV.TEACHER_TOKEN || "",
  TEACHER_WS_TOKEN: __ENV.TEACHER_WS_TOKEN || "",

  // 組織資訊
  ORG_ID: __ENV.ORG_ID || "",
  TEACHER_ID: __ENV.TEACHER_ID || __ENV.ORG_ID || "",
  DISPLAY_NAME: __ENV.DISPLAY_NAME || "Teacher",
  REGION: __ENV.REGION || "TW",

  // 教室設定
  ROOM_ID: __ENV.ROOM_ID || "",
  COLLECTION_ID: __ENV.COLLECTION_ID || "",

  // 時間設定 (秒)
  STUDENT_SESSION_TIME: parseInt(__ENV.STUDENT_SESSION_TIME || "90", 10),
  TEACHER_DELAY: parseInt(__ENV.TEACHER_DELAY || "30", 10),
  STUDENT_WAIT_TIME: parseInt(__ENV.STUDENT_WAIT_TIME || "60", 10),

  // 內部時間配置
  STUDENT_WAIT_FOR_TEACHER: 1,
  STUDENT_RANDOM_DELAY_MAX: 1.5,

  // WebSocket 重連配置
  WS_MAX_RETRIES: parseInt(__ENV.WS_MAX_RETRIES || "3", 10),
  WS_RETRY_DELAY: parseInt(__ENV.WS_RETRY_DELAY || "2", 10),  // 基礎延遲秒數

  // 動態時間配置（可透過環境變數覆蓋，0 表示自動計算）
  QUIZ_CREATE_DELAY: parseInt(__ENV.QUIZ_CREATE_DELAY || "0", 10),  // 創建 Quiz 延遲秒數
  ANSWER_WAIT_TIME: parseInt(__ENV.ANSWER_WAIT_TIME || "0", 10),    // 等待作答時間秒數
};

/**
 * 驗證必要的環境變數
 */
export function validateConfig(requiredFields: (keyof Config)[]): void {
  const missing = requiredFields.filter((field) => !CONFIG[field]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * 將物件轉為 URL 查詢字串 (k6 不支援 URLSearchParams)
 */
function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
}

/**
 * 取得 WebSocket URL
 */
export function getWsUrl(
  role: "student" | "teacher",
  params: Record<string, string> = {}
): string {
  const baseUrl = CONFIG.SOCKET_URL.replace("http://", "ws://").replace(
    "https://",
    "wss://"
  );

  const queryParams = toQueryString({
    role,
    EIO: "4",
    transport: "websocket",
    ...params,
  });

  return `${baseUrl}/sockets/?${queryParams}`;
}

/**
 * 取得老師 WebSocket URL (含認證)
 */
export function getTeacherWsUrl(): string {
  return getWsUrl("teacher", {
    access_token: CONFIG.TEACHER_WS_TOKEN,
    org_id: CONFIG.ORG_ID,
    display_name: CONFIG.DISPLAY_NAME,
    region: CONFIG.REGION,
  });
}

/**
 * 取得學生 WebSocket URL
 */
export function getStudentWsUrl(): string {
  return getWsUrl("student");
}
