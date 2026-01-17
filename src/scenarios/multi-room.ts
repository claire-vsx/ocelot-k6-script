/**
 * 多教室壓力測試
 *
 * 模擬多間教室同時進行課程，每間教室有 1 位老師和 N 位學生
 *
 * Usage:
 *   npm run build && k6 run dist/multi-room.js
 */

import { sleep, group } from "k6";
import ws from "k6/ws";
import exec from "k6/execution";
import { Options } from "k6/options";

import {
  NUM_ROOMS,
  STUDENTS_PER_ROOM,
  VUS_PER_ROOM,
  TOTAL_VUS,
  CONFIG,
  getTeacherWsUrl,
  getStudentWsUrl,
} from "../lib/config";

import {
  studentConnected,
  studentSeated,
  seatWithin3s,
  answersSubmitted,
  eventsReceived,
  teacherConnected,
  errors,
  timeToSeat,
  wsConnectTime,
  quizReceivedTime,
  wsConnectionDuration,
  wsConnectingTime,
  wsEvents,
  wsConnection,
} from "../lib/metrics";

import {
  NAMESPACE,
  TEACHER_NAMESPACE,
  encodeEvent,
  parseMessage,
  uuid,
} from "../lib/socketio";

import {
  createRoom,
  createLesson,
  getLesson,
  startLesson,
  endLesson,
  chooseSeat,
  createQuizzes,
  fetchQuiz,
  submitAnswers,
  finishQuiz,
  closeQuiz,
  discloseQuiz,
} from "../lib/api";

import { QuizCreatedEvent } from "../lib/types";

// === 驗證 ===
if (NUM_ROOMS === 0) {
  throw new Error(
    "NUM_ROOMS environment variable is required.\nExample: NUM_ROOMS=4"
  );
}

// === K6 設定 ===
export const options: Options = {
  scenarios: {
    multi_room: {
      executor: "per-vu-iterations",
      vus: TOTAL_VUS,
      iterations: 1,
      maxDuration: "5m",
      exec: "multiRoomScenario",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.1"],
    "http_req_duration{name:choose_seat}": ["p(95)<3000"],
    "http_req_duration{name:submit_answers}": ["p(95)<3000"],
    student_connected: ["rate>0.9"],
    student_seated: ["rate>0.9"],
    seat_within_3s: ["rate>0.95"],
  },
};

interface SetupData {
  roomIds: string[];
}

// === Setup ===
export function setup(): SetupData {
  console.log("=".repeat(70));
  console.log("MULTI-ROOM CLASSROOM STRESS TEST");
  console.log("=".repeat(70));
  console.log(`API: ${CONFIG.API_URL}`);
  console.log(
    `Rooms: ${NUM_ROOMS} | Students/Room: ${STUDENTS_PER_ROOM} | Total VUs: ${TOTAL_VUS}`
  );
  console.log("=".repeat(70));

  const roomIds: string[] = [];
  for (let i = 0; i < NUM_ROOMS; i++) {
    const roomId = createRoom(i);
    if (!roomId) throw new Error(`Failed to create room ${i + 1}`);
    roomIds.push(roomId);
    sleep(0.5);
  }

  console.log(`Created ${roomIds.length} rooms: ${roomIds.join(", ")}`);
  return { roomIds };
}

// === Student Behavior ===
// 返回 true 表示成功連線並完成流程，false 表示連線失敗需要重試
function studentBehavior(
  roomId: string,
  lessonId: string,
  studentNum: number,
  startTimestamp: number
): boolean {
  const deviceId = uuid();
  const wsUrl = getStudentWsUrl();

  let studentId: string | null = null;
  let socketToken: string | null = null;
  let nsSid: string | null = null;
  let currentBatchId: string | null = null;
  let quizReceived = false;
  let connectionSuccess = false; // 追蹤連線是否成功
  const joinTime = Date.now();

  ws.connect(wsUrl, {}, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      const connectTime = Date.now() - wsStart;
      wsConnectTime.add(connectTime);
      wsConnectingTime.add(connectTime);
      wsConnection.connected.add(1);
      connectionSuccess = true; // 標記連線成功
    });

    socket.on("close", () => {
      const duration = Date.now() - wsStart;
      wsConnectionDuration.add(duration);
      (quizReceived
        ? wsConnection.disconnected
        : wsConnection.unexpectedClose
      ).add(1);
    });

    socket.on("message", (msg: string) => {
      const parsed = parseMessage(msg);
      if (!parsed) return;

      switch (parsed.type) {
        case "open":
          socket.send(`40${NAMESPACE},${JSON.stringify({ role: "student" })}`);
          break;

        case "ping":
          socket.send("3");
          break;

        case "connect":
          if (parsed.namespace === NAMESPACE) {
            nsSid = (parsed.data?.sid as string) || null;
            wsConnection.namespaceConnected.add(1);

            const seat = chooseSeat(
              lessonId,
              studentNum,
              nsSid || "",
              deviceId,
              roomId
            );
            if (seat) {
              studentId = seat.studentId;
              socketToken = seat.token;
              studentSeated.add(1);

              const totalTimeToSeat = Date.now() - startTimestamp;
              timeToSeat.add(totalTimeToSeat);
              seatWithin3s.add(totalTimeToSeat <= 3000 ? 1 : 0);

              if (totalTimeToSeat > 3000) {
                console.warn(
                  `[Room ${roomId}] Student ${studentNum}: ${totalTimeToSeat}ms to seat (>3s)`
                );
              }

              socket.send(
                encodeEvent(NAMESPACE, "join_lesson", {
                  lesson_id: lessonId,
                  user_id: studentId,
                  role: "student",
                  access_token: socketToken,
                })
              );
              wsConnection.joinLessonSent.add(1);
            } else {
              studentSeated.add(0);
              seatWithin3s.add(0);
            }
          }
          break;

        case "event":
          if (parsed.namespace !== NAMESPACE || !studentId) break;

          switch (parsed.event) {
            case "batch_quizzes_created": {
              wsEvents.quizCreated.add(1);
              const eventData = parsed.data as QuizCreatedEvent;
              const batchId = eventData?.batch_quizzes_id;
              if (batchId && batchId !== currentBatchId) {
                currentBatchId = batchId;
                quizReceived = true;
                eventsReceived.add(1);
                quizReceivedTime.add(Date.now() - joinTime);

                sleep(0.5 + Math.random());

                const quiz = fetchQuiz(lessonId, studentId);
                if (quiz) {
                  answersSubmitted.add(
                    submitAnswers(batchId, studentId, quiz) ? 1 : 0
                  );
                }
              }
              break;
            }
            case "batch_quizzes_finished":
              wsEvents.quizFinished.add(1);
              break;
            case "batch_quizzes_disclosed":
              wsEvents.quizDisclosed.add(1);
              break;
            case "batch_quizzes_closed":
              wsEvents.quizClosed.add(1);
              break;
            case "student_points_updated":
              wsEvents.studentPoints.add(1);
              break;
            case "end_lesson":
              wsEvents.endLesson.add(1);
              socket.close();
              break;
          }
          break;
      }
    });

    socket.on("error", (e: Error) => {
      console.error(`[Room ${roomId}] Student ${studentNum} WS error: ${e}`);
      wsConnection.error.add(1);
      errors.add(1);
      // 注意：不在這裡調用 studentConnected.add(0)
      // 因為 error 事件可能多次觸發，會導致 Rate 分母錯誤
      // 連線失敗的記錄在 ws.connect 外部處理
    });

    // 動態計算學生 timeout：確保有足夠時間等待 Quiz
    const quizDelay = calculateQuizCreateDelay() / 1000;
    const answerWait = calculateAnswerWaitTime() / 1000;
    const timeout = (quizDelay + answerWait + 30) * 1000; // 額外 30 秒緩衝
    socket.setTimeout(() => {
      if (!quizReceived) eventsReceived.add(0);
      socket.close();
    }, timeout);
  });

  return connectionSuccess;
}

// === Student Behavior with Retry ===
function studentBehaviorWithRetry(
  roomId: string,
  lessonId: string,
  studentNum: number,
  startTimestamp: number
): void {
  const maxRetries = CONFIG.WS_MAX_RETRIES;
  const baseDelay = CONFIG.WS_RETRY_DELAY;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 指數退避：2^attempt * baseDelay 秒
      const delay = Math.pow(2, attempt - 1) * baseDelay;
      console.warn(
        `[Room ${roomId}] Student ${studentNum}: Retry ${attempt}/${maxRetries} after ${delay}s`
      );
      wsConnection.retryAttempts.add(1);
      sleep(delay);
    }

    const success = studentBehavior(
      roomId,
      lessonId,
      studentNum,
      startTimestamp
    );

    if (success) {
      if (attempt > 0) {
        wsConnection.retrySuccess.add(1);
        console.log(
          `[Room ${roomId}] Student ${studentNum}: Reconnected on attempt ${
            attempt + 1
          }`
        );
      }
      studentConnected.add(1);
      return;
    }
  }

  // 所有重試都失敗
  console.error(
    `[Room ${roomId}] Student ${studentNum}: All ${
      maxRetries + 1
    } connection attempts failed`
  );
  studentConnected.add(0);
  studentSeated.add(0);
  seatWithin3s.add(0);
}

// === 動態時間計算 ===
function calculateQuizCreateDelay(): number {
  // 如果有設定環境變數，使用設定值
  if (CONFIG.QUIZ_CREATE_DELAY > 0) {
    return CONFIG.QUIZ_CREATE_DELAY * 1000;
  }
  // 動態計算：基礎延遲 + 每 10 個學生多 5 秒
  // 例如：30 + 45 = 75s (基礎)，50 學生再加 25s = 100s
  const baseDelay = CONFIG.TEACHER_DELAY + 45;
  const studentFactor = Math.floor(STUDENTS_PER_ROOM / 10) * 5;
  return (baseDelay + studentFactor) * 1000;
}

function calculateAnswerWaitTime(): number {
  // 如果有設定環境變數，使用設定值
  if (CONFIG.ANSWER_WAIT_TIME > 0) {
    return CONFIG.ANSWER_WAIT_TIME * 1000;
  }
  // 動態計算：學生數越多，等待時間越長
  // 基礎 30 秒 + 每 10 個學生多 5 秒
  const baseWait = 30;
  const studentFactor = Math.floor(STUDENTS_PER_ROOM / 10) * 5;
  return (
    Math.max(baseWait + studentFactor, CONFIG.STUDENT_SESSION_TIME - 10) * 1000
  );
}

// === Teacher Behavior ===
function teacherBehavior(roomId: string, lessonId: string): void {
  console.log(`[Room ${roomId}] Teacher starting...`);

  const wsUrl = getTeacherWsUrl();
  let batchId: string | null = null;
  let submittedCount = 0;
  let quizCreated = false;
  let namespaceConnected = false;

  // 動態時間配置
  const quizCreateDelay = calculateQuizCreateDelay();
  const answerWaitTime = calculateAnswerWaitTime();
  console.log(
    `[Room ${roomId}] Quiz delay: ${quizCreateDelay / 1000}s, Answer wait: ${
      answerWaitTime / 1000
    }s`
  );

  ws.connect(wsUrl, {}, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      const connectTime = Date.now() - wsStart;
      wsConnectingTime.add(connectTime);
      teacherConnected.add(1);
      wsConnection.connected.add(1);
    });

    socket.on("close", () => {
      wsConnection.disconnected.add(1);
    });

    socket.on("message", (msg: string) => {
      const parsed = parseMessage(msg);
      if (!parsed) return;

      switch (parsed.type) {
        case "open":
          // 老師使用 /teacher namespace，帶 auth 參數
          socket.send(
            `40${TEACHER_NAMESPACE},${JSON.stringify({
              role: "teacher",
              access_token: CONFIG.TEACHER_WS_TOKEN,
              org_id: CONFIG.ORG_ID,
              display_name: CONFIG.DISPLAY_NAME,
              region: CONFIG.REGION,
            })}`
          );
          break;

        case "ping":
          socket.send("3");
          break;

        case "connect":
          if (parsed.namespace === TEACHER_NAMESPACE && !namespaceConnected) {
            namespaceConnected = true;
            wsConnection.namespaceConnected.add(1);

            socket.send(
              encodeEvent(TEACHER_NAMESPACE, "join_lesson", {
                lesson_id: lessonId,
                user_id: CONFIG.TEACHER_ID,
                role: "teacher",
              })
            );
            wsConnection.teacherJoinLessonSent.add(1);
            console.log(`[Room ${roomId}] Teacher joined lesson`);

            // 第一階段：等待學生加入後創建測驗
            // 使用 setTimeout 而非 sleep，避免阻塞 WebSocket 事件處理
            socket.setTimeout(() => {
              group("teacher_actions", () => {
                batchId = createQuizzes(lessonId);
                quizCreated = !!batchId;
                if (batchId) {
                  console.log(`[Room ${roomId}] Quiz created: ${batchId}`);
                }
              });

              // 第二階段：等待學生作答後結束課程
              // 在創建測驗後設置下一個 timeout
              socket.setTimeout(() => {
                console.log(
                  `[Room ${roomId}] Teacher timeout, ${submittedCount} submitted`
                );

                group("teacher_finish", () => {
                  if (quizCreated && batchId) {
                    finishQuiz(lessonId, batchId);
                    console.log(`[Room ${roomId}] Quiz finished`);
                    sleep(1);
                    discloseQuiz(lessonId, batchId);
                    console.log(`[Room ${roomId}] Quiz disclosed`);
                    sleep(1);
                    closeQuiz(lessonId, batchId);
                    console.log(`[Room ${roomId}] Quiz closed`);
                    sleep(1);
                  }
                  endLesson(lessonId);
                  console.log(`[Room ${roomId}] Lesson ended`);
                });

                socket.close();
              }, answerWaitTime);
            }, quizCreateDelay);
          }
          break;

        case "event":
          if (
            parsed.namespace === TEACHER_NAMESPACE &&
            parsed.event === "batch_quizzes_student_submitted"
          ) {
            submittedCount++;
            wsEvents.studentSubmitted.add(1);
            console.log(
              `[Room ${roomId}] Student submitted (${submittedCount}/${STUDENTS_PER_ROOM})`
            );
          }
          break;
      }
    });

    socket.on("error", (e: Error) => {
      console.error(`[Room ${roomId}] Teacher WS error: ${e}`);
      errors.add(1);
      wsConnection.error.add(1);
      teacherConnected.add(0);
    });
  });
}

// === Main Scenario ===
export function multiRoomScenario(data: SetupData): void {
  const { roomIds } = data;
  const vuId = exec.vu.idInInstance;
  const roomIndex = Math.floor((vuId - 1) / VUS_PER_ROOM);
  const positionInRoom = (vuId - 1) % VUS_PER_ROOM;
  const isTeacher = positionInRoom === 0;

  if (roomIndex >= roomIds.length) {
    console.error(`VU ${vuId} has invalid roomIndex ${roomIndex}`);
    return;
  }

  const roomId = roomIds[roomIndex];

  if (isTeacher) {
    const lessonId = createLesson(roomId);
    if (!lessonId) {
      console.error(`[Room ${roomId}] Failed to create lesson`);
      teacherConnected.add(0);
      return;
    }
    startLesson(lessonId);
    console.log(`[Room ${roomId}] Lesson started: ${lessonId}`);
    teacherBehavior(roomId, lessonId);
  } else {
    sleep(CONFIG.TEACHER_DELAY);
    const startTimestamp = Date.now();
    sleep(CONFIG.STUDENT_WAIT_FOR_TEACHER);
    sleep(Math.random() * CONFIG.STUDENT_RANDOM_DELAY_MAX);

    const lessonId = getLesson(roomId);
    if (!lessonId) {
      console.error(
        `[Room ${roomId}] Student ${positionInRoom}: Failed to get lesson`
      );
      studentConnected.add(0);
      studentSeated.add(0);
      seatWithin3s.add(0);
      return;
    }

    // 使用帶重連機制的版本
    studentBehaviorWithRetry(roomId, lessonId, positionInRoom, startTimestamp);
  }
}

// === Teardown ===
export function teardown(data: SetupData): void {
  sleep(2);
  const roomCount = data.roomIds?.length || NUM_ROOMS;
  console.log("=".repeat(70));
  console.log(
    `TEST COMPLETED | Rooms: ${roomCount} | Expected students: ${
      roomCount * STUDENTS_PER_ROOM
    }`
  );
  console.log("=".repeat(70));
}
