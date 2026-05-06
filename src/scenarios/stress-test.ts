/**
 * 階梯式壓力測試
 *
 * 逐步增加負載找出系統極限，用於：
 * - 找出系統 breaking point
 * - 測試 auto-scaling 行為
 * - 驗證 graceful degradation
 *
 * Usage:
 *   source .env.local && pnpm test:stress-test
 *   source .env.local && pnpm test:stress-test:influxdb
 *
 *   覆寫環境變數可 inline：
 *     MAX_VUS=500 STAGES=10 STAGE_DURATION=120s pnpm test:stress-test:influxdb
 *
 * 環境變數:
 *   MAX_VUS:        最大虛擬用戶數 (預設 50，對齊 STUDENTS_PER_ROOM 預設值)
 *   STAGES:         階梯數 (預設 5)
 *   STAGE_DURATION: 每階段持續時間 (預設 60s)
 */

import { sleep, check } from 'k6';
import ws from 'k6/ws';
import exec from 'k6/execution';
import { Options } from 'k6/options';
import { Counter, Rate, Trend } from 'k6/metrics';

import {
    CONFIG,
    STUDENTS_PER_ROOM,
    getStudentWsUrl,
    getTeacherWsUrl,
    getWsHeaders,
} from '../lib/config';

import {
    NAMESPACE,
    TEACHER_NAMESPACE,
    encodeEvent,
    parseMessage,
    uuid,
} from '../lib/socketio';

import {
    createRoom,
    createLesson,
    startLesson,
    endLesson,
    chooseSeat,
    createQuizzes,
    fetchQuiz,
    submitAnswers,
    finishQuiz,
    closeQuiz,
    discloseQuiz,
} from '../lib/api';

import { wsConnection, wsEvents, deliveryTs } from '../lib/metrics';

// K6 環境變數
declare const __ENV: Record<string, string | undefined>;

// === 配置 ===
const MAX_VUS = parseInt(__ENV.MAX_VUS || '50', 10);
const STAGE_DURATION = __ENV.STAGE_DURATION || '60s';
const STAGES = parseInt(__ENV.STAGES || '5', 10);

// === 自訂指標 ===
const stressConnected = new Rate('stress_connected');
const stressSeated = new Rate('stress_seated');
const stressSeatTime = new Trend('stress_seat_time');
const stressErrors = new Counter('stress_errors');
const stressStage = new Counter('stress_stage');
const teacherConnected = new Rate('teacher_connected');
const quizCreated = new Rate('quiz_created');
const lessonEnded = new Rate('lesson_ended');

// === K6 設定：階梯式增加負載 ===
function generateStages(): Array<{ duration: string; target: number }> {
    const stages: Array<{ duration: string; target: number }> = [];
    const increment = Math.floor(MAX_VUS / STAGES);

    for (let i = 1; i <= STAGES; i++) {
        const target = increment * i;
        // Ramp up
        stages.push({ duration: '30s', target });
        // Sustain
        stages.push({ duration: STAGE_DURATION, target });
    }

    // Recovery
    stages.push({ duration: '30s', target: Math.floor(MAX_VUS / 4) });
    stages.push({ duration: '60s', target: Math.floor(MAX_VUS / 4) });
    stages.push({ duration: '30s', target: 0 });

    return stages;
}

// 計算測試總時長
function calculateTotalDurationMs(): number {
    const stages = generateStages();
    let totalSeconds = 0;
    for (const stage of stages) {
        const match = stage.duration.match(/(\d+)s/);
        if (match) totalSeconds += parseInt(match[1], 10);
    }
    return totalSeconds * 1000;
}

// 老師 scenario maxDuration (額外加 60 秒緩衝)
function calculateTotalDuration(): string {
    return `${calculateTotalDurationMs() / 1000 + 60}s`;
}

export const options: Options = {
    scenarios: {
        // 老師 scenario：持續連線直到測試結束
        teacher: {
            executor: 'per-vu-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: calculateTotalDuration(),
            exec: 'teacherScenario',
            gracefulStop: '30s',
        },
        // 學生 scenario：階梯式增加負載
        stress_test: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: generateStages(),
            gracefulRampDown: '30s',
            exec: 'stressScenario',
            startTime: '10s',  // 等老師先連線
        },
    },
    thresholds: {
        // 壓力測試允許較高的失敗率
        http_req_failed: ['rate<0.2'],  // 允許 20% 失敗
        'http_req_duration{name:choose_seat}': ['p(95)<10000'],  // 允許較長時間
        stress_connected: ['rate>0.5'],  // 至少 50% 連線成功
        stress_seated: ['rate>0.5'],     // 至少 50% 選座成功
        teacher_connected: ['rate==1'],  // 老師必須連線成功
    },
};

interface SetupData {
    roomId: string;
    lessonId: string;
}

// === Setup: 創建測試用教室 ===
export function setup(): SetupData {
    // 座位數需 ≥ MAX_VUS，否則後段 ramping 的 VU 會全部選座 409
    const seatCapacity = Math.max(STUDENTS_PER_ROOM, MAX_VUS);

    console.log('='.repeat(70));
    console.log('STRESS TEST - RAMPING VUS WITH TEACHER');
    console.log('='.repeat(70));
    console.log(`API: ${CONFIG.API_URL}`);
    console.log(`Max VUs: ${MAX_VUS} | Stages: ${STAGES} | Stage Duration: ${STAGE_DURATION}`);
    console.log(`Seat Capacity: ${seatCapacity} (STUDENTS_PER_ROOM=${STUDENTS_PER_ROOM}, MAX_VUS=${MAX_VUS})`);
    console.log(`Generated ${generateStages().length} stages`);
    console.log(`Total Duration: ${calculateTotalDuration()}`);
    console.log('Scenarios: 1 Teacher + Ramping Students');
    console.log('='.repeat(70));

    // 創建一個大教室供所有 VU 使用
    const roomId = createRoom(0, seatCapacity);
    if (!roomId) throw new Error('Failed to create room for stress test');

    const lessonId = createLesson(roomId);
    if (!lessonId) throw new Error('Failed to create lesson for stress test');

    startLesson(lessonId);
    console.log(`Room: ${roomId}, Lesson: ${lessonId}`);

    return { roomId, lessonId };
}

// === 老師場景 ===
export function teacherScenario(data: SetupData): void {
    const { roomId, lessonId } = data;
    const wsUrl = getTeacherWsUrl();

    let batchId: string | null = null;
    let quizCreatedFlag = false;
    let namespaceConnected = false;

    console.log('[Teacher] Starting teacher scenario...');

    ws.connect(wsUrl, { headers: getWsHeaders(CONFIG.TEACHER_ID) }, socket => {
        socket.on('open', () => {
            teacherConnected.add(1);
            wsConnection.connected.add(1);
            console.log('[Teacher] WebSocket connected');
        });

        socket.on('close', () => {
            wsConnection.disconnected.add(1);
            console.log('[Teacher] WebSocket closed');
        });

        socket.on('message', (msg: string) => {
            const parsed = parseMessage(msg);
            if (!parsed) return;

            switch (parsed.type) {
                case 'open':
                    // 老師使用 /teacher namespace，帶 auth 參數
                    socket.send(`40${TEACHER_NAMESPACE},${JSON.stringify({
                        role: 'teacher',
                        access_token: CONFIG.TEACHER_WS_TOKEN,
                        org_id: CONFIG.ORG_ID,
                        display_name: CONFIG.DISPLAY_NAME,
                        region: CONFIG.REGION,
                    })}`);
                    break;

                case 'ping':
                    socket.send('3');
                    break;

                case 'connect':
                    if (parsed.namespace === TEACHER_NAMESPACE && !namespaceConnected) {
                        namespaceConnected = true;
                        wsConnection.namespaceConnected.add(1);
                        console.log('[Teacher] Namespace connected');

                        socket.send(encodeEvent(TEACHER_NAMESPACE, 'join_lesson', {
                            lesson_id: lessonId,
                            user_id: CONFIG.TEACHER_ID,
                            role: 'teacher',
                        }));
                        wsConnection.teacherJoinLessonSent.add(1);
                        console.log(`[Teacher] Joined lesson: ${lessonId}`);

                        // 等待學生加入後創建測驗
                        socket.setTimeout(() => {
                            batchId = createQuizzes(lessonId);
                            quizCreatedFlag = !!batchId;
                            quizCreated.add(quizCreatedFlag ? 1 : 0);
                            if (batchId) {
                                deliveryTs.quizCreated.add(Date.now(), { room: roomId, role: 'teacher' });
                                console.log(`[Teacher] Quiz created: ${batchId}`);
                            }
                        }, 30000);  // 30 秒後創建測驗
                    }
                    break;

                case 'event':
                    if (parsed.namespace === TEACHER_NAMESPACE) {
                        if (parsed.event === 'batch_quizzes_student_submitted') {
                            wsEvents.studentSubmitted.add(1);
                            deliveryTs.studentSubmitted.add(Date.now(), { room: roomId, role: 'teacher' });
                        }
                    }
                    break;
            }
        });

        socket.on('error', (e: Error) => {
            console.error(`[Teacher] WS error: ${e}`);
            stressErrors.add(1);
            wsConnection.error.add(1);
            teacherConnected.add(0);
        });

        // 計算老師需要保持連線的時間
        const totalMs = calculateTotalDurationMs();

        // 在測試快結束時結束課程
        socket.setTimeout(() => {
            console.log('[Teacher] Finishing up...');
            if (quizCreatedFlag && batchId) {
                finishQuiz(lessonId, batchId);
                deliveryTs.quizFinished.add(Date.now(), { room: roomId, role: 'teacher' });
                console.log('[Teacher] Quiz finished');
                sleep(1);
                discloseQuiz(lessonId, batchId);
                deliveryTs.quizDisclosed.add(Date.now(), { room: roomId, role: 'teacher' });
                console.log('[Teacher] Quiz disclosed');
                sleep(1);
                closeQuiz(lessonId, batchId);
                deliveryTs.quizClosed.add(Date.now(), { room: roomId, role: 'teacher' });
                console.log('[Teacher] Quiz closed');
                sleep(1);
            }
            endLesson(lessonId);
            deliveryTs.lessonEnd.add(Date.now(), { room: roomId, role: 'teacher' });
            lessonEnded.add(1);
            console.log('[Teacher] Lesson ended');
            socket.close();
        }, totalMs);
    });
}

// === 壓力測試場景 (學生) ===
export function stressScenario(data: SetupData): void {
    const { roomId, lessonId } = data;
    const deviceId = uuid();
    // 用 VU id 當 serial_number，避免 random 撞號導致後端 400
    const studentNum = exec.vu.idInInstance;
    const wsUrl = getStudentWsUrl();

    let connected = false;
    let seated = false;
    let studentId: string | null = null;
    let socketToken: string | null = null;
    let endLessonReceived = false;

    const tags = { room: roomId, student: String(studentNum) };
    const deliveryTags = { room: roomId, role: 'student', student: String(studentNum) };

    // 嘗試連線
    ws.connect(wsUrl, { headers: getWsHeaders(deviceId) }, socket => {
        socket.on('open', () => {
            connected = true;
            stressConnected.add(1);
            wsConnection.connected.add(1, tags);
        });

        socket.on('close', () => {
            (endLessonReceived
                ? wsConnection.disconnected
                : wsConnection.unexpectedClose
            ).add(1, tags);
        });

        socket.on('message', (msg: string) => {
            const parsed = parseMessage(msg);
            if (!parsed) return;

            switch (parsed.type) {
                case 'open':
                    socket.send(`40${NAMESPACE},${JSON.stringify({ role: 'student' })}`);
                    break;

                case 'ping':
                    socket.send('3');
                    break;

                case 'connect':
                    if (parsed.namespace === NAMESPACE) {
                        const nsSid = (parsed.data?.sid as string) || '';
                        wsConnection.namespaceConnected.add(1, tags);

                        // 嘗試選座
                        const startTime = Date.now();
                        const seat = chooseSeat(lessonId, studentNum, nsSid, deviceId, roomId);

                        if (seat) {
                            seated = true;
                            studentId = seat.studentId;
                            socketToken = seat.token;
                            stressSeated.add(1);
                            stressSeatTime.add(Date.now() - startTime);

                            // 發送 join_lesson 事件
                            socket.send(encodeEvent(NAMESPACE, 'join_lesson', {
                                lesson_id: lessonId,
                                user_id: studentId,
                                role: 'student',
                                access_token: socketToken,
                            }));
                            wsConnection.joinLessonSent.add(1, tags);
                        } else {
                            stressSeated.add(0);
                            stressErrors.add(1);
                        }
                    }
                    break;

                case 'event':
                    if (parsed.namespace !== NAMESPACE || !studentId) break;

                    switch (parsed.event) {
                        case 'batch_quizzes_created': {
                            wsEvents.quizCreated.add(1, tags);
                            deliveryTs.quizCreated.add(Date.now(), deliveryTags);

                            // 抓題目並送答 (與 multi-room 行為一致)
                            const eventData = parsed.data as { batch_quizzes_id?: string };
                            const batchId = eventData?.batch_quizzes_id;
                            if (!batchId || !studentId) break;

                            sleep(0.5 + Math.random());
                            const quiz = fetchQuiz(lessonId, studentId);
                            if (quiz) {
                                const submitted = submitAnswers(batchId, studentId, quiz);
                                if (submitted) {
                                    deliveryTs.studentSubmitted.add(Date.now(), deliveryTags);
                                }
                            }
                            break;
                        }
                        case 'batch_quizzes_finished':
                            wsEvents.quizFinished.add(1, tags);
                            deliveryTs.quizFinished.add(Date.now(), deliveryTags);
                            break;
                        case 'batch_quizzes_disclosed':
                            wsEvents.quizDisclosed.add(1, tags);
                            deliveryTs.quizDisclosed.add(Date.now(), deliveryTags);
                            break;
                        case 'batch_quizzes_closed':
                            wsEvents.quizClosed.add(1, tags);
                            deliveryTs.quizClosed.add(Date.now(), deliveryTags);
                            break;
                        case 'student_points_updated':
                            wsEvents.studentPoints.add(1, tags);
                            break;
                        case 'end_lesson':
                            wsEvents.endLesson.add(1, tags);
                            deliveryTs.lessonEnd.add(Date.now(), deliveryTags);
                            endLessonReceived = true;
                            socket.close();
                            break;
                    }
                    break;
            }
        });

        socket.on('error', () => {
            stressErrors.add(1);
            wsConnection.error.add(1, tags);
        });

        // 撐滿整段測試時長：每個 VU 對應一個固定座位，
        // 不能讓 iteration 結束後重啟新 iteration（會用同 serial 撞 409）。
        // ramp-down 時 k6 會以 gracefulRampDown 自然關閉多餘 VU。
        socket.setTimeout(() => {
            socket.close();
        }, calculateTotalDurationMs());
    });

    // 記錄未連線的情況
    if (!connected) {
        stressConnected.add(0);
    }

    // 隨機間隔，模擬真實用戶
    sleep(1 + Math.random() * 2);
}

// === Teardown ===
export function teardown(data: SetupData): void {
    console.log('='.repeat(70));
    console.log('STRESS TEST WITH TEACHER COMPLETED');
    console.log(`Room: ${data.roomId}, Lesson: ${data.lessonId}`);
    console.log('='.repeat(70));
}
