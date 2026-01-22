/**
 * 指定教室測試
 *
 * 針對指定的現有教室進行測試，使用雙場景架構：學生場景 + 教師場景
 *
 * Usage:
 *   pnpm build && k6 run dist/specified-one-room.js -e ROOM_ID=xxx
 */

import { sleep, group } from 'k6';
import ws from 'k6/ws';
import exec from 'k6/execution';
import { Options } from 'k6/options';

import { CONFIG, getTeacherWsUrl, getStudentWsUrl } from '../lib/config';

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
} from '../lib/metrics';

import { NAMESPACE, TEACHER_NAMESPACE, encodeEvent, parseMessage, uuid } from '../lib/socketio';

import {
    createLesson,
    startLesson,
    endLesson,
    chooseSeat,
    createQuizzes,
    fetchQuiz,
    submitAnswers,
    finishQuiz,
    discloseQuiz,
    closeQuiz,
} from '../lib/api';

import { QuizCreatedEvent } from '../lib/types';

// K6 環境變數
declare const __ENV: Record<string, string | undefined>;

const NUM_STUDENTS = parseInt(__ENV.NUM_STUDENTS || '50', 10);
const TEACHER_DELAY = parseInt(__ENV.TEACHER_DELAY || '10', 10);
const STUDENT_WAIT_TIME = parseInt(__ENV.STUDENT_WAIT_TIME || '60', 10);

// === 驗證 ===
if (!CONFIG.ROOM_ID) {
    throw new Error('ROOM_ID environment variable is required');
}

// === K6 設定 ===
export const options: Options = {
    scenarios: {
        students: {
            executor: 'per-vu-iterations',
            vus: NUM_STUDENTS,
            iterations: 1,
            maxDuration: '5m',
            exec: 'studentScenario',
        },
        teacher: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            startTime: `${TEACHER_DELAY}s`,
            maxDuration: '5m',
            exec: 'teacherScenario',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.1'],
        'http_req_duration{name:choose_seat}': ['p(95)<3000'],
        'http_req_duration{name:submit_answers}': ['p(95)<3000'],
        student_connected: ['rate>0.9'],
        student_seated: ['rate>0.9'],
        seat_within_3s: ['rate>0.95'],
        events_received: ['rate>0.8'],
        answers_submitted: ['rate>0.8'],
    },
};

interface SetupData {
    lessonId: string;
}

// === Setup ===
export function setup(): SetupData {
    console.log('='.repeat(60));
    console.log('SINGLE-ROOM CLASSROOM TEST');
    console.log('='.repeat(60));
    console.log(`API: ${CONFIG.API_URL}`);
    console.log(`Room: ${CONFIG.ROOM_ID}`);
    console.log(`Students: ${NUM_STUDENTS}`);
    console.log(`Teacher delay: ${TEACHER_DELAY}s`);
    console.log('='.repeat(60));

    const lessonId = createLesson(CONFIG.ROOM_ID);
    if (!lessonId) throw new Error('Failed to create lesson');

    startLesson(lessonId);
    console.log(`Lesson started: ${lessonId}`);

    return { lessonId };
}

// === Student Scenario ===
export function studentScenario(data: SetupData): void {
    const studentNum = exec.scenario.iterationInTest + 1;
    const lessonId = data.lessonId;
    const deviceId = uuid();

    sleep(Math.random() * 3);
    const startTimestamp = Date.now();

    console.log(`Student ${studentNum}: Starting...`);

    const wsUrl = getStudentWsUrl();
    let studentId: string | null = null;
    let socketToken: string | null = null;
    let nsSid: string | null = null;
    let quizReceived = false;
    const joinTime = Date.now();

    ws.connect(wsUrl, { headers: { 'sticky-id': deviceId } }, socket => {
        const wsStart = Date.now();

        socket.on('open', () => {
            const connectTime = Date.now() - wsStart;
            wsConnectTime.add(connectTime);
            wsConnectingTime.add(connectTime);
            studentConnected.add(1);
            wsConnection.connected.add(1);
        });

        socket.on('close', () => {
            wsConnectionDuration.add(Date.now() - wsStart);
            (quizReceived ? wsConnection.disconnected : wsConnection.unexpectedClose).add(1);
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
                        nsSid = (parsed.data?.sid as string) || null;
                        wsConnection.namespaceConnected.add(1);

                        const seat = chooseSeat(lessonId, studentNum, nsSid || '', deviceId);
                        if (seat) {
                            studentId = seat.studentId;
                            socketToken = seat.token;
                            studentSeated.add(1);

                            const totalTimeToSeat = Date.now() - startTimestamp;
                            timeToSeat.add(totalTimeToSeat);
                            seatWithin3s.add(totalTimeToSeat <= 3000 ? 1 : 0);

                            if (totalTimeToSeat > 3000) {
                                console.warn(`Student ${studentNum}: ${totalTimeToSeat}ms to seat (>3s)`);
                            }

                            socket.send(encodeEvent(NAMESPACE, 'join_lesson', {
                                lesson_id: lessonId,
                                user_id: studentId,
                                role: 'student',
                                access_token: socketToken,
                            }));
                            wsConnection.joinLessonSent.add(1);
                        } else {
                            studentSeated.add(0);
                            seatWithin3s.add(0);
                        }
                    }
                    break;

                case 'event':
                    if (parsed.namespace !== NAMESPACE || !studentId) break;

                    switch (parsed.event) {
                        case 'batch_quizzes_created': {
                            wsEvents.quizCreated.add(1);
                            if (!quizReceived) {
                                quizReceived = true;
                                eventsReceived.add(1);
                                quizReceivedTime.add(Date.now() - joinTime);

                                const eventData = parsed.data as QuizCreatedEvent;
                                const batchId = eventData?.batch_quizzes_id;
                                sleep(0.5 + Math.random());

                                const quiz = fetchQuiz(lessonId, studentId);
                                if (quiz && batchId) {
                                    answersSubmitted.add(submitAnswers(batchId, studentId, quiz) ? 1 : 0);
                                }
                            }
                            break;
                        }
                        case 'batch_quizzes_finished':
                            wsEvents.quizFinished.add(1);
                            break;
                        case 'batch_quizzes_disclosed':
                            wsEvents.quizDisclosed.add(1);
                            break;
                        case 'batch_quizzes_closed':
                            wsEvents.quizClosed.add(1);
                            break;
                        case 'student_points_updated':
                            wsEvents.studentPoints.add(1);
                            break;
                        case 'end_lesson':
                            wsEvents.endLesson.add(1);
                            socket.close();
                            break;
                    }
                    break;
            }
        });

        socket.on('error', (e: Error) => {
            console.error(`Student ${studentNum}: WS Error - ${e}`);
            errors.add(1);
            wsConnection.error.add(1);
            studentConnected.add(0);
        });

        socket.setTimeout(() => {
            if (!quizReceived) eventsReceived.add(0);
            socket.close();
        }, STUDENT_WAIT_TIME * 1000);
    });
}

// === Teacher Scenario ===
export function teacherScenario(data: SetupData): void {
    const lessonId = data.lessonId;

    console.log('='.repeat(60));
    console.log('TEACHER: Starting...');
    console.log('='.repeat(60));

    const wsUrl = getTeacherWsUrl();
    let batchId: string | null = null;
    let submittedCount = 0;
    let quizCreated = false;
    let namespaceConnected = false;

    // 時間配置
    const quizCreateDelay = 2 * 1000; // 2s 後創建測驗
    const answerWaitTime = Math.max(STUDENT_WAIT_TIME - 20, 30) * 1000; // 作答等待時間

    ws.connect(wsUrl, { headers: { 'sticky-id': CONFIG.TEACHER_ID } }, socket => {
        const wsStart = Date.now();

        socket.on('open', () => {
            const connectTime = Date.now() - wsStart;
            wsConnectingTime.add(connectTime);
            teacherConnected.add(1);
            wsConnection.connected.add(1);
        });

        socket.on('close', () => wsConnection.disconnected.add(1));

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

                        socket.send(encodeEvent(TEACHER_NAMESPACE, 'join_lesson', {
                            lesson_id: lessonId,
                            user_id: CONFIG.TEACHER_ID,
                            role: 'teacher',
                        }));
                        wsConnection.teacherJoinLessonSent.add(1);
                        console.log('TEACHER: Joined lesson');

                        // 第一階段：等待學生加入後創建測驗
                        socket.setTimeout(() => {
                            group('teacher_actions', () => {
                                batchId = createQuizzes(lessonId);
                                quizCreated = !!batchId;
                                if (batchId) {
                                    console.log(`TEACHER: Quiz created, batchId=${batchId}`);
                                }
                            });

                            // 第二階段：等待學生作答後結束課程
                            socket.setTimeout(() => {
                                console.log(`TEACHER: Timeout, ${submittedCount} students submitted`);

                                group('teacher_finish', () => {
                                    if (quizCreated && batchId) {
                                        finishQuiz(lessonId, batchId);
                                        console.log('TEACHER: Quiz finished');
                                        sleep(1);
                                        discloseQuiz(lessonId, batchId);
                                        console.log('TEACHER: Quiz disclosed');
                                        sleep(1);
                                        closeQuiz(lessonId, batchId);
                                        console.log('TEACHER: Quiz closed');
                                        sleep(1);
                                    }
                                    endLesson(lessonId);
                                    console.log('TEACHER: Lesson ended');
                                });

                                socket.close();
                            }, answerWaitTime);
                        }, quizCreateDelay);
                    }
                    break;

                case 'event':
                    if (parsed.namespace === TEACHER_NAMESPACE && parsed.event === 'batch_quizzes_student_submitted') {
                        submittedCount++;
                        wsEvents.studentSubmitted.add(1);
                    }
                    break;
            }
        });

        socket.on('error', (e: Error) => {
            console.error(`TEACHER: WS Error - ${e}`);
            errors.add(1);
            wsConnection.error.add(1);
            teacherConnected.add(0);
        });
    });
}

// === Teardown ===
export function teardown(data: SetupData): void {
    sleep(2);
    console.log('='.repeat(60));
    console.log(`TEST COMPLETED | Lesson: ${data.lessonId}`);
    console.log('='.repeat(60));
}

