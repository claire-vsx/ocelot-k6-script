/**
 * 階梯式壓力測試
 *
 * 逐步增加負載找出系統極限，用於：
 * - 找出系統 breaking point
 * - 測試 auto-scaling 行為
 * - 驗證 graceful degradation
 *
 * Usage:
 *   npm run build && k6 run dist/stress-test.js
 *
 * 環境變數:
 *   MAX_VUS: 最大虛擬用戶數 (預設 200)
 *   STAGE_DURATION: 每階段持續時間秒數 (預設 60)
 */

import { sleep, check } from 'k6';
import ws from 'k6/ws';
import { Options } from 'k6/options';
import { Counter, Rate, Trend } from 'k6/metrics';

import {
    CONFIG,
    getStudentWsUrl,
    getTeacherWsUrl,
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
    finishQuiz,
    closeQuiz,
    discloseQuiz,
} from '../lib/api';

// K6 環境變數
declare const __ENV: Record<string, string | undefined>;

// === 配置 ===
const MAX_VUS = parseInt(__ENV.MAX_VUS || '200', 10);
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

// 計算測試總時長 (用於老師 scenario)
function calculateTotalDuration(): string {
    const stages = generateStages();
    let totalSeconds = 0;
    for (const stage of stages) {
        const match = stage.duration.match(/(\d+)s/);
        if (match) totalSeconds += parseInt(match[1], 10);
    }
    // 額外加 60 秒緩衝
    return `${totalSeconds + 60}s`;
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
    console.log('='.repeat(70));
    console.log('STRESS TEST - RAMPING VUS WITH TEACHER');
    console.log('='.repeat(70));
    console.log(`API: ${CONFIG.API_URL}`);
    console.log(`Max VUs: ${MAX_VUS} | Stages: ${STAGES} | Stage Duration: ${STAGE_DURATION}`);
    console.log(`Generated ${generateStages().length} stages`);
    console.log(`Total Duration: ${calculateTotalDuration()}`);
    console.log('Scenarios: 1 Teacher + Ramping Students');
    console.log('='.repeat(70));

    // 創建一個大教室供所有 VU 使用
    const roomId = createRoom(0);
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

    ws.connect(wsUrl, { headers: { 'sticky-id': CONFIG.TEACHER_ID } }, socket => {
        socket.on('open', () => {
            teacherConnected.add(1);
            console.log('[Teacher] WebSocket connected');
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
                        console.log('[Teacher] Namespace connected');

                        socket.send(encodeEvent(TEACHER_NAMESPACE, 'join_lesson', {
                            lesson_id: lessonId,
                            user_id: CONFIG.TEACHER_ID,
                            role: 'teacher',
                        }));
                        console.log(`[Teacher] Joined lesson: ${lessonId}`);

                        // 等待學生加入後創建測驗
                        socket.setTimeout(() => {
                            batchId = createQuizzes(lessonId);
                            quizCreatedFlag = !!batchId;
                            quizCreated.add(quizCreatedFlag ? 1 : 0);
                            if (batchId) {
                                console.log(`[Teacher] Quiz created: ${batchId}`);
                            }
                        }, 30000);  // 30 秒後創建測驗
                    }
                    break;

                case 'event':
                    if (parsed.namespace === TEACHER_NAMESPACE) {
                        if (parsed.event === 'batch_quizzes_student_submitted') {
                            console.log('[Teacher] Student submitted answer');
                        }
                    }
                    break;
            }
        });

        socket.on('error', (e: Error) => {
            console.error(`[Teacher] WS error: ${e}`);
            stressErrors.add(1);
            teacherConnected.add(0);
        });

        // 計算老師需要保持連線的時間
        const stages = generateStages();
        let totalMs = 0;
        for (const stage of stages) {
            const match = stage.duration.match(/(\d+)s/);
            if (match) totalMs += parseInt(match[1], 10) * 1000;
        }

        // 在測試快結束時結束課程
        socket.setTimeout(() => {
            console.log('[Teacher] Finishing up...');
            if (quizCreatedFlag && batchId) {
                finishQuiz(lessonId, batchId);
                console.log('[Teacher] Quiz finished');
                sleep(1);
                discloseQuiz(lessonId, batchId);
                console.log('[Teacher] Quiz disclosed');
                sleep(1);
                closeQuiz(lessonId, batchId);
                console.log('[Teacher] Quiz closed');
                sleep(1);
            }
            endLesson(lessonId);
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
    const studentNum = Math.floor(Math.random() * 9999);
    const wsUrl = getStudentWsUrl();

    let connected = false;
    let seated = false;
    let studentId: string | null = null;
    let socketToken: string | null = null;

    // 嘗試連線
    ws.connect(wsUrl, { headers: { 'sticky-id': deviceId } }, socket => {
        socket.on('open', () => {
            connected = true;
            stressConnected.add(1);
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
                        } else {
                            stressSeated.add(0);
                            stressErrors.add(1);
                        }
                    }
                    break;

                case 'event':
                    if (parsed.namespace === NAMESPACE && studentId) {
                        // 可以在這裡處理 quiz 事件等
                        if (parsed.event === 'end_lesson') {
                            socket.close();
                        }
                    }
                    break;
            }
        });

        socket.on('error', () => {
            stressErrors.add(1);
        });

        // 短暫停留後斷開
        socket.setTimeout(() => {
            socket.close();
        }, 30000);  // 30 秒後斷開 (延長以接收更多事件)
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
