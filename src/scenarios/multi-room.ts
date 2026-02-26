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
  getWsHeaders,
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
  deliveryTs,
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
function studentBehavior(
  roomId: string,
  lessonId: string,
  studentNum: number,
  startTimestamp: number
): void {
  const deviceId = uuid();
  const wsUrl = getStudentWsUrl();

  let studentId: string | null = null;
  let socketToken: string | null = null;
  let nsSid: string | null = null;
  let currentBatchId: string | null = null;
  let quizReceived = false;
  let connectionSuccess = false;
  const joinTime = Date.now();

  const tags = { room: roomId, student: String(studentNum) };

  ws.connect(wsUrl, { headers: getWsHeaders(deviceId) }, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      connectionSuccess = true;
      const connectTime = Date.now() - wsStart;
      wsConnectTime.add(connectTime, tags);
      wsConnectingTime.add(connectTime, tags);
      wsConnection.connected.add(1, tags);
      studentConnected.add(1, tags);
    });

    socket.on("close", () => {
      const duration = Date.now() - wsStart;
      wsConnectionDuration.add(duration, tags);
      (quizReceived
        ? wsConnection.disconnected
        : wsConnection.unexpectedClose
      ).add(1, tags);
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
            wsConnection.namespaceConnected.add(1, tags);

            const seatStart = Date.now();
            const seat = chooseSeat(
              lessonId,
              studentNum,
              nsSid || "",
              deviceId,
              roomId
            );
            const seatDuration = Date.now() - seatStart;
            if (seat) {
              studentId = seat.studentId;
              socketToken = seat.token;
              studentSeated.add(1, tags);

              const totalTimeToSeat = Date.now() - startTimestamp;
              timeToSeat.add(totalTimeToSeat, tags);
              seatWithin3s.add(seatDuration <= 3000 ? 1 : 0, tags);

              if (seatDuration > 3000) {
                console.warn(
                  `[Room ${roomId}] Student ${studentNum}: ${seatDuration}ms to seat (>3s)`
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
              wsConnection.joinLessonSent.add(1, tags);
            } else {
              studentSeated.add(0, tags);
              seatWithin3s.add(0, tags);
            }
          }
          break;

        case "event":
          if (parsed.namespace !== NAMESPACE || !studentId) break;

          switch (parsed.event) {
            case "batch_quizzes_created": {
              wsEvents.quizCreated.add(1, tags);
              const eventData = parsed.data as QuizCreatedEvent;
              const batchId = eventData?.batch_quizzes_id;
              if (batchId && batchId !== currentBatchId) {
                currentBatchId = batchId;
                quizReceived = true;
                eventsReceived.add(1, tags);
                quizReceivedTime.add(Date.now() - joinTime, tags);
                deliveryTs.quizCreated.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });

                sleep(0.5 + Math.random());

                const quiz = fetchQuiz(lessonId, studentId);
                if (quiz) {
                  const submitted = submitAnswers(batchId, studentId, quiz);
                  answersSubmitted.add(submitted ? 1 : 0, tags);
                  if (submitted) {
                    deliveryTs.studentSubmitted.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });
                  }
                }
              }
              break;
            }
            case "batch_quizzes_finished":
              wsEvents.quizFinished.add(1, tags);
              deliveryTs.quizFinished.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });
              break;
            case "batch_quizzes_disclosed":
              wsEvents.quizDisclosed.add(1, tags);
              deliveryTs.quizDisclosed.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });
              break;
            case "batch_quizzes_closed":
              wsEvents.quizClosed.add(1, tags);
              deliveryTs.quizClosed.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });
              break;
            case "student_points_updated":
              wsEvents.studentPoints.add(1, tags);
              break;
            case "end_lesson":
              wsEvents.endLesson.add(1, tags);
              deliveryTs.lessonEnd.add(Date.now(), { room: roomId, role: "student", student: String(studentNum) });
              socket.close();
              break;
          }
          break;
      }
    });

    socket.on("error", (e: Error) => {
      console.error(`[Room ${roomId}] Student ${studentNum} WS error: ${e.message || e}`);
      wsConnection.error.add(1, tags);
      errors.add(1, tags);
      if (!connectionSuccess) {
        studentConnected.add(0, tags);
      }
    });

    // 動態計算學生 timeout：確保有足夠時間等待 Quiz
    const quizDelay = calculateQuizCreateDelay() / 1000;
    const answerWait = calculateAnswerWaitTime() / 1000;
    const timeout = (quizDelay + answerWait + 30) * 1000; // 額外 30 秒緩衝
    socket.setTimeout(() => {
      if (!quizReceived) eventsReceived.add(0, tags);
      socket.close();
    }, timeout);
  });
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
  let connectionSuccess = false;

  // 動態時間配置
  const quizCreateDelay = calculateQuizCreateDelay();
  const answerWaitTime = calculateAnswerWaitTime();
  console.log(
    `[Room ${roomId}] Quiz delay: ${quizCreateDelay / 1000}s, Answer wait: ${
      answerWaitTime / 1000
    }s`
  );

  ws.connect(wsUrl, { headers: getWsHeaders(CONFIG.TEACHER_ID) }, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      connectionSuccess = true;
      const connectTime = Date.now() - wsStart;
      wsConnectingTime.add(connectTime);
      teacherConnected.add(1);
      wsConnection.connected.add(1);
    });

    socket.on("close", () => {
      console.log(`[Room ${roomId}] Teacher WS closed`);
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
                  deliveryTs.quizCreated.add(Date.now(), { room: roomId, role: "teacher" });
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
                    deliveryTs.quizFinished.add(Date.now(), { room: roomId, role: "teacher" });
                    console.log(`[Room ${roomId}] Quiz finished`);
                    sleep(1);
                    discloseQuiz(lessonId, batchId);
                    deliveryTs.quizDisclosed.add(Date.now(), { room: roomId, role: "teacher" });
                    console.log(`[Room ${roomId}] Quiz disclosed`);
                    sleep(1);
                    closeQuiz(lessonId, batchId);
                    deliveryTs.quizClosed.add(Date.now(), { room: roomId, role: "teacher" });
                    console.log(`[Room ${roomId}] Quiz closed`);
                    sleep(1);
                  }
                  endLesson(lessonId);
                  deliveryTs.lessonEnd.add(Date.now(), { room: roomId, role: "teacher" });
                  console.log(`[Room ${roomId}] Lesson ended`);
                });

                sleep(2);
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
            wsEvents.studentSubmitted.add(1, { room: roomId, student: String(submittedCount) });
            deliveryTs.studentSubmitted.add(Date.now(), { room: roomId, role: "teacher", student: String(submittedCount) });
            console.log(
              `[Room ${roomId}] Student submitted (${submittedCount}/${STUDENTS_PER_ROOM})`
            );
          }
          break;
      }
    });

    socket.on("error", (e: Error) => {
      console.error(`[Room ${roomId}] Teacher WS error: ${e.message || e}`);
      errors.add(1);
      wsConnection.error.add(1);
      if (!connectionSuccess) {
        teacherConnected.add(0);
      }
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

    studentBehavior(roomId, lessonId, positionInRoom, startTimestamp);
  }
}

// === Teardown ===
export function teardown(data: SetupData): void {
  sleep(6); // Wait for InfluxDB final flush
  const roomCount = data.roomIds?.length || NUM_ROOMS;
  console.log("=".repeat(70));
  console.log(
    `TEST COMPLETED | Rooms: ${roomCount} | Expected students: ${
      roomCount * STUDENTS_PER_ROOM
    }`
  );
  console.log("=".repeat(70));
}
