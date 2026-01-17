/**
 * K6 Metrics 定義
 */

import { Counter, Trend, Rate } from "k6/metrics";

// === 核心指標 ===
export const studentConnected = new Rate("student_connected");
export const studentSeated = new Rate("student_seated");
export const seatWithin3s = new Rate("seat_within_3s");
export const answersSubmitted = new Rate("answers_submitted");
export const eventsReceived = new Rate("events_received");
export const teacherConnected = new Rate("teacher_connected");
export const errors = new Counter("errors");

// === 時間指標 ===
export const seatTime = new Trend("seat_time");
export const submitTime = new Trend("submit_time");
export const timeToSeat = new Trend("time_to_seat");
export const wsConnectTime = new Trend("ws_connect_time");
export const quizReceivedTime = new Trend("quiz_received_time");
export const wsConnectionDuration = new Trend("ws_connection_duration");

// === WebSocket Timing Metrics (自訂) ===
// 注意: ws_connecting, ws_session_duration, ws_sessions, ws_msgs_received, ws_msgs_sent
// 這些是 k6 內建的 WebSocket metrics，不需要重複定義
export const wsConnectingTime = new Trend("ws_connecting_time");

// === WebSocket 事件計數 ===
export const wsEvents = {
  quizCreated: new Counter("ws_event_quiz_created"),
  quizFinished: new Counter("ws_event_quiz_finished"),
  quizDisclosed: new Counter("ws_event_quiz_disclosed"),
  quizClosed: new Counter("ws_event_quiz_closed"),
  studentPoints: new Counter("ws_event_student_points"),
  endLesson: new Counter("ws_event_end_lesson"),
  studentSubmitted: new Counter("ws_event_student_submitted"),
} as const;

// === WebSocket 連線狀態 ===
// 注意: ws_sessions, ws_msgs_received, ws_msgs_sent 是 k6 內建的，會自動追蹤
export const wsConnection = {
  connected: new Counter("ws_connected"),
  disconnected: new Counter("ws_disconnected"),
  error: new Counter("ws_connection_error"),
  unexpectedClose: new Counter("ws_unexpected_close"),
  namespaceConnected: new Counter("ws_namespace_connected"),
  joinLessonSent: new Counter("ws_join_lesson_sent"),
  teacherJoinLessonSent: new Counter("ws_teacher_join_lesson_sent"),
  seatChosen: new Counter("ws_seat_chosen"),
  // 重連相關
  retryAttempts: new Counter("ws_retry_attempts"),
  retrySuccess: new Counter("ws_retry_success"),
} as const;

// === HTTP 錯誤計數 ===
type HttpErrorCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 502
  | 503
  | 504
  | "timeout"
  | "other";

export const httpErrors: Record<HttpErrorCode, Counter> = {
  400: new Counter("http_error_400"),
  401: new Counter("http_error_401"),
  403: new Counter("http_error_403"),
  404: new Counter("http_error_404"),
  409: new Counter("http_error_409"),
  422: new Counter("http_error_422"),
  429: new Counter("http_error_429"),
  500: new Counter("http_error_500"),
  502: new Counter("http_error_502"),
  503: new Counter("http_error_503"),
  504: new Counter("http_error_504"),
  timeout: new Counter("http_error_timeout"),
  other: new Counter("http_error_other"),
};

// === choose_seat 錯誤 ===
type SeatErrorCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | "timeout"
  | "other";

export const seatErrors: Record<SeatErrorCode, Counter> = {
  400: new Counter("seat_error_400"),
  401: new Counter("seat_error_401"),
  403: new Counter("seat_error_403"),
  404: new Counter("seat_error_404"),
  409: new Counter("seat_error_409"),
  422: new Counter("seat_error_422"),
  429: new Counter("seat_error_429"),
  500: new Counter("seat_error_500"),
  timeout: new Counter("seat_error_timeout"),
  other: new Counter("seat_error_other"),
};

// === HTTP 成功計數 ===
export const httpSuccess = {
  createRoom: new Counter("http_success_create_room"),
  createLesson: new Counter("http_success_create_lesson"),
  startLesson: new Counter("http_success_start_lesson"),
  endLesson: new Counter("http_success_end_lesson"),
  chooseSeat: new Counter("http_success_choose_seat"),
  createQuizzes: new Counter("http_success_create_quizzes"),
  fetchQuiz: new Counter("http_success_fetch_quiz"),
  submitAnswers: new Counter("http_success_submit_answers"),
  finishQuiz: new Counter("http_success_finish_quiz"),
  closeQuiz: new Counter("http_success_close_quiz"),
  discloseQuiz: new Counter("http_success_disclose_quiz"),
  addPoints: new Counter("http_success_add_points"),
} as const;

// === Room 計數 ===
export const roomLessonCreated = new Counter("room_lesson_created");
export const roomStudentsSeated = new Counter("room_students_seated");

/**
 * 記錄 HTTP 錯誤
 */
export function recordHttpError(status: number, endpoint?: string): void {
  const key: HttpErrorCode =
    status === 0
      ? "timeout"
      : httpErrors[status as keyof typeof httpErrors]
      ? (status as HttpErrorCode)
      : "other";
  httpErrors[key].add(1);

  if (endpoint === "choose_seat") {
    const seatKey: SeatErrorCode =
      status === 0
        ? "timeout"
        : seatErrors[status as keyof typeof seatErrors]
        ? (status as SeatErrorCode)
        : "other";
    seatErrors[seatKey].add(1);
  }
}
