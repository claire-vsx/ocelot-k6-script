/**
 * 長時間負載測試 - 多教室模擬真實課堂
 *
 * 模擬多間教室同時進行課程，每堂課持續 30-45 分鐘，老師多次發送測驗
 *
 * 環境變數：
 *   NUM_ROOMS        - 教室數量，預設 1
 *   STUDENTS_PER_ROOM - 每間教室學生數，預設 50
 *   LESSON_DURATION  - 課程時長（分鐘），預設 30
 *   QUIZ_COUNT       - 測驗次數，預設 5
 *   QUIZ_INTERVAL    - 測驗間隔（分鐘），預設 5
 *
 * Usage:
 *   npm run build && k6 run dist/load-test.js \
 *     -e NUM_ROOMS=4 \
 *     -e STUDENTS_PER_ROOM=50 \
 *     -e LESSON_DURATION=30 \
 *     -e QUIZ_COUNT=5
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
  wsConnectingTime,
  quizReceivedTime,
  wsConnectionDuration,
  wsEvents,
  wsConnection,
} from "../lib/metrics";

import { NAMESPACE, encodeEvent, parseMessage, uuid } from "../lib/socketio";

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
  discloseQuiz,
  closeQuiz,
} from "../lib/api";

import { QuizCreatedEvent } from "../lib/types";

// K6 環境變數
declare const __ENV: Record<string, string | undefined>;

// === 負載測試配置 ===
const LESSON_DURATION = parseInt(__ENV.LESSON_DURATION || "30", 10); // 分鐘
const QUIZ_COUNT = parseInt(__ENV.QUIZ_COUNT || "5", 10);
const QUIZ_INTERVAL = parseInt(__ENV.QUIZ_INTERVAL || "5", 10); // 分鐘

// 計算時間（毫秒）
const LESSON_DURATION_MS = LESSON_DURATION * 60 * 1000;
const QUIZ_INTERVAL_MS = QUIZ_INTERVAL * 60 * 1000;
const FIRST_QUIZ_DELAY_MS = 2 * 60 * 1000; // 第一次測驗在 2 分鐘後

// === 驗證 ===
if (NUM_ROOMS === 0) {
  throw new Error(
    "NUM_ROOMS environment variable is required.\nExample: NUM_ROOMS=4"
  );
}

// === K6 設定 ===
export const options: Options = {
  scenarios: {
    load_test: {
      executor: "per-vu-iterations",
      vus: TOTAL_VUS,
      iterations: 1,
      maxDuration: `${LESSON_DURATION + 10}m`, // 課程時長 + 緩衝
      exec: "loadTestScenario",
      gracefulStop: "60s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.1"],
    "http_req_duration{name:choose_seat}": ["p(95)<3000"],
    "http_req_duration{name:submit_answers}": ["p(95)<3000"],
    student_connected: ["rate>0.9"],
    student_seated: ["rate>0.9"],
    seat_within_3s: ["rate>0.95"],
    events_received: ["rate>0.8"],
    answers_submitted: ["rate>0.8"],
  },
};

interface SetupData {
  roomIds: string[];
}

// === Setup ===
export function setup(): SetupData {
  console.log("=".repeat(70));
  console.log("LOAD TEST - MULTI-ROOM REALISTIC CLASSROOM SIMULATION");
  console.log("=".repeat(70));
  console.log(`API: ${CONFIG.API_URL}`);
  console.log(
    `Rooms: ${NUM_ROOMS} | Students/Room: ${STUDENTS_PER_ROOM} | Total VUs: ${TOTAL_VUS}`
  );
  console.log(`Lesson Duration: ${LESSON_DURATION} minutes`);
  console.log(
    `Quiz Count: ${QUIZ_COUNT} | Quiz Interval: ${QUIZ_INTERVAL} minutes`
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
  let quizCount = 0;
  let lastBatchId: string | null = null;
  const joinTime = Date.now();

  // 斷線原因追蹤
  let lessonEnded = false; // 收到 end_lesson 事件
  let timedOut = false; // 超時主動斷線
  let hasError = false; // 發生錯誤

  ws.connect(wsUrl, {}, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      const connectTime = Date.now() - wsStart;
      wsConnectTime.add(connectTime);
      wsConnectingTime.add(connectTime);
      wsConnection.connected.add(1);
      studentConnected.add(1);
    });

    socket.on("close", () => {
      const duration = Date.now() - wsStart;
      wsConnectionDuration.add(duration);

      // 判斷斷線類型
      if (lessonEnded || timedOut) {
        // 正常斷線：課程結束或超時
        wsConnection.disconnected.add(1);
      } else if (!hasError) {
        // 非預期斷線：不是課程結束、不是超時、也沒有錯誤
        wsConnection.unexpectedClose.add(1);
        console.warn(
          `[Room ${roomId}] Student ${studentNum}: Unexpected disconnect after ${Math.round(
            duration / 1000
          )}s, quizzes: ${quizCount}`
        );
      }
      // 如果 hasError=true，已經在 error handler 中記錄了
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
              console.log(
                `[Room ${roomId}] Student ${studentNum}: Joined, waiting for quizzes...`
              );
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
              const eventData = parsed.data as unknown as QuizCreatedEvent;
              const batchId = eventData?.batch_quizzes_id;

              // 處理每一次測驗（檢查 batchId 避免重複處理）
              if (batchId && batchId !== lastBatchId) {
                lastBatchId = batchId;
                quizCount++;
                eventsReceived.add(1);

                if (quizCount === 1) {
                  quizReceivedTime.add(Date.now() - joinTime);
                }

                console.log(
                  `[Room ${roomId}] Student ${studentNum}: Quiz #${quizCount} received`
                );

                // 模擬學生思考時間
                sleep(0.5 + Math.random() * 2);

                const quiz = fetchQuiz(lessonId, studentId);
                if (quiz) {
                  const submitted = submitAnswers(batchId, studentId, quiz);
                  answersSubmitted.add(submitted ? 1 : 0);
                  if (submitted) {
                    console.log(
                      `[Room ${roomId}] Student ${studentNum}: Quiz #${quizCount} submitted`
                    );
                  }
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
              lessonEnded = true;
              console.log(
                `[Room ${roomId}] Student ${studentNum}: Lesson ended, quizzes: ${quizCount}`
              );
              socket.close();
              break;
          }
          break;
      }
    });

    socket.on("error", (e) => {
      hasError = true;
      console.error(`[Room ${roomId}] Student ${studentNum}: WS Error - ${e}`);
      wsConnection.error.add(1);
      errors.add(1);
      studentConnected.add(0);
    });

    // 設置超時（課程時長 + 緩衝）
    const timeout = LESSON_DURATION_MS + 120000;
    socket.setTimeout(() => {
      timedOut = true;
      if (quizCount === 0) eventsReceived.add(0);
      console.log(
        `[Room ${roomId}] Student ${studentNum}: Timeout after ${
          LESSON_DURATION + 2
        } min, quizzes: ${quizCount}`
      );
      socket.close();
    }, timeout);
  });
}

// === Teacher Behavior ===
function teacherBehavior(roomId: string, lessonId: string): void {
  console.log(
    `[Room ${roomId}] Teacher: Starting, ${QUIZ_COUNT} quizzes over ${LESSON_DURATION} minutes`
  );

  const wsUrl = getTeacherWsUrl();
  let currentQuiz = 0;
  let namespaceConnected = false;
  const quizBatchIds: string[] = [];
  const submittedCounts: number[] = [];

  // 斷線原因追蹤
  let lessonFinished = false; // 正常完成課程
  let hasError = false; // 發生錯誤

  ws.connect(wsUrl, {}, (socket) => {
    const wsStart = Date.now();

    socket.on("open", () => {
      const connectTime = Date.now() - wsStart;
      wsConnectingTime.add(connectTime);
      teacherConnected.add(1);
      wsConnection.connected.add(1);
    });

    socket.on("close", () => {
      const duration = Date.now() - wsStart;
      if (lessonFinished) {
        wsConnection.disconnected.add(1);
      } else if (!hasError) {
        wsConnection.unexpectedClose.add(1);
        console.warn(
          `[Room ${roomId}] Teacher: Unexpected disconnect after ${Math.round(
            duration / 1000
          )}s, quizzes: ${currentQuiz}/${QUIZ_COUNT}`
        );
      }
    });

    socket.on("message", (msg: string) => {
      const parsed = parseMessage(msg);
      if (!parsed) return;

      switch (parsed.type) {
        case "open":
          socket.send(`40${NAMESPACE},${JSON.stringify({ role: "teacher" })}`);
          break;

        case "ping":
          socket.send("3");
          break;

        case "connect":
          if (parsed.namespace === NAMESPACE && !namespaceConnected) {
            namespaceConnected = true;
            wsConnection.namespaceConnected.add(1);

            socket.send(
              encodeEvent(NAMESPACE, "join_lesson", {
                lesson_id: lessonId,
                user_id: "teacher",
                role: "teacher",
                access_token: CONFIG.TEACHER_TOKEN,
              })
            );
            wsConnection.teacherJoinLessonSent.add(1);
            console.log(`[Room ${roomId}] Teacher: Joined lesson`);

            // 開始測驗循環
            scheduleNextQuiz(socket, lessonId, FIRST_QUIZ_DELAY_MS);
          }
          break;

        case "event":
          if (
            parsed.namespace === NAMESPACE &&
            parsed.event === "batch_quizzes_student_submitted"
          ) {
            if (currentQuiz > 0) {
              submittedCounts[currentQuiz - 1] =
                (submittedCounts[currentQuiz - 1] || 0) + 1;
            }
            wsEvents.studentSubmitted.add(1);
          }
          break;
      }
    });

    socket.on("error", (e) => {
      hasError = true;
      console.error(`[Room ${roomId}] Teacher: WS Error - ${e}`);
      errors.add(1);
      wsConnection.error.add(1);
      teacherConnected.add(0);
    });

    // 發送測驗的遞迴函數
    function scheduleNextQuiz(
      sock: typeof socket,
      lId: string,
      delay: number
    ): void {
      sock.setTimeout(() => {
        if (currentQuiz >= QUIZ_COUNT) {
          finishLesson(sock, lId);
          return;
        }

        currentQuiz++;
        console.log(
          `[Room ${roomId}] Teacher: Creating quiz #${currentQuiz}/${QUIZ_COUNT}...`
        );

        group("teacher_create_quiz", () => {
          const batchId = createQuizzes(lessonId);
          if (batchId) {
            quizBatchIds.push(batchId);
            submittedCounts.push(0);
            console.log(
              `[Room ${roomId}] Teacher: Quiz #${currentQuiz} created`
            );

            // 等待學生作答後結束這個測驗
            sock.setTimeout(() => {
              const submitted = submittedCounts[currentQuiz - 1] || 0;
              console.log(
                `[Room ${roomId}] Teacher: Quiz #${currentQuiz} - ${submitted}/${STUDENTS_PER_ROOM} submitted`
              );

              group("teacher_finish_quiz", () => {
                finishQuiz(lessonId, batchId);
                sleep(0.5);
                discloseQuiz(lessonId, batchId);
                sleep(0.5);
                closeQuiz(lessonId, batchId);
              });

              console.log(
                `[Room ${roomId}] Teacher: Quiz #${currentQuiz} closed`
              );

              // 安排下一個測驗
              if (currentQuiz < QUIZ_COUNT) {
                scheduleNextQuiz(sock, lId, QUIZ_INTERVAL_MS);
              } else {
                // 最後一個測驗完成，等待一下再結束課程
                sock.setTimeout(() => {
                  finishLesson(sock, lId);
                }, 30000);
              }
            }, Math.max(90000, Math.floor(QUIZ_INTERVAL_MS * 0.7))); // 作答等待時間：測驗間隔的 70%，至少 90 秒
          } else {
            console.error(
              `[Room ${roomId}] Teacher: Failed to create quiz #${currentQuiz}`
            );
          }
        });
      }, delay);
    }

    // 結束課程
    function finishLesson(sock: typeof socket, lId: string): void {
      console.log(`[Room ${roomId}] Teacher: Finishing lesson...`);
      console.log(`[Room ${roomId}] Total quizzes: ${quizBatchIds.length}`);
      submittedCounts.forEach((count, i) => {
        console.log(
          `[Room ${roomId}]   Quiz #${
            i + 1
          }: ${count}/${STUDENTS_PER_ROOM} submitted`
        );
      });

      group("teacher_end_lesson", () => {
        endLesson(lId);
        console.log(`[Room ${roomId}] Teacher: Lesson ended`);
      });

      lessonFinished = true;
      sleep(2);
      sock.close();
    }
  });
}

// === Main Scenario ===
export function loadTestScenario(data: SetupData): void {
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
    // 老師：創建課程並開始
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
    // 學生：等待老師創建課程後加入
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
  sleep(2);
  const roomCount = data.roomIds?.length || NUM_ROOMS;
  console.log("=".repeat(70));
  console.log("LOAD TEST COMPLETED");
  console.log(`Rooms: ${roomCount} | Students/Room: ${STUDENTS_PER_ROOM}`);
  console.log(`Duration: ${LESSON_DURATION} minutes | Quizzes: ${QUIZ_COUNT}`);
  console.log("=".repeat(70));
}
