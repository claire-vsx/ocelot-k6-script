/**
 * HTTP API 函數
 */

import http, { RefinedResponse, ResponseType } from "k6/http";
import { check } from "k6";
import { CONFIG, STUDENTS_PER_ROOM } from "./config";
import {
  httpSuccess,
  recordHttpError,
  seatTime,
  submitTime,
  roomLessonCreated,
  roomStudentsSeated,
  wsConnection,
} from "./metrics";
import { SeatResult, QuizResponse, Answer } from "./types";

/**
 * 取得 HTTP Headers
 */
export function getHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// === Room API ===

export function createRoom(roomIndex: number): string | null {
  const displayName = `k6_${Date.now()}_${roomIndex + 1}`;
  const payload = {
    org_id: CONFIG.ORG_ID,
    teacher_id: CONFIG.TEACHER_ID,
    student_count: STUDENTS_PER_ROOM,
    display_name: displayName,
    icon: 1,
  };

  const res = http.post(
    `${CONFIG.API_URL}/api/v3/rooms?student_list=true&grouping=true`,
    JSON.stringify(payload),
    { headers: getHeaders(CONFIG.TEACHER_TOKEN), tags: { name: "create_room" } }
  );

  if (
    check(res, {
      "room created": (r: RefinedResponse<ResponseType>) =>
        r.status === 200 || r.status === 201,
    })
  ) {
    httpSuccess.createRoom.add(1);
    const data = res.json() as { data?: { room_id: string }; room_id?: string };
    const roomId = data.data?.room_id || data.room_id;
    console.log(`Room ${roomIndex + 1} created: ${roomId}`);
    return roomId || null;
  }
  console.error(`Failed to create room ${roomIndex + 1}: ${res.status}`);
  recordHttpError(res.status, "create_room");
  return null;
}

// === Lesson API ===

export function createLesson(roomId: string): string | null {
  const res = http.post(
    `${CONFIG.API_URL}/api/v3/rooms/${roomId}/lessons`,
    JSON.stringify({}),
    {
      headers: getHeaders(CONFIG.TEACHER_TOKEN),
      tags: { name: "create_lesson", room: roomId },
    }
  );

  if (
    check(res, {
      "lesson created": (r: RefinedResponse<ResponseType>) =>
        r.status === 200 || r.status === 201,
    })
  ) {
    httpSuccess.createLesson.add(1);
    roomLessonCreated.add(1);
    const data = res.json() as {
      data?: { lesson_id: string };
      lesson_id?: string;
      id?: string;
    };
    return data.data?.lesson_id || data.lesson_id || data.id || null;
  }
  console.error(`[Room ${roomId}] Failed to create lesson: ${res.status}`);
  recordHttpError(res.status, "create_lesson");
  return null;
}

export function getLesson(roomId: string): string | null {
  // 注意：這個 API 是 idempotent 的
  // 如果 room 已有活躍的 lesson，會返回現有的而不是創建新的
  const res = http.post(
    `${CONFIG.API_URL}/api/v3/rooms/${roomId}/lessons`,
    JSON.stringify({}),
    {
      headers: getHeaders(CONFIG.TEACHER_TOKEN),
      tags: { name: "get_lesson", room: roomId },
    }
  );

  if (res.status === 200 || res.status === 201) {
    const data = res.json() as {
      data?: { lesson_id: string };
      lesson_id?: string;
      id?: string;
    };
    return data.data?.lesson_id || data.lesson_id || data.id || null;
  }
  return null;
}

export function startLesson(lessonId: string): boolean {
  const res = http.put(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/time`,
    JSON.stringify({ is_start: true }),
    {
      headers: getHeaders(CONFIG.TEACHER_TOKEN),
      tags: { name: "start_lesson" },
    }
  );
  if (
    check(res, {
      "lesson started": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.startLesson.add(1);
    return true;
  }
  recordHttpError(res.status, "start_lesson");
  return false;
}

export function endLesson(lessonId: string): boolean {
  const res = http.post(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/end`,
    null,
    { headers: getHeaders(CONFIG.TEACHER_TOKEN), tags: { name: "end_lesson" } }
  );
  if (
    check(res, {
      "lesson ended": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.endLesson.add(1);
    return true;
  }
  recordHttpError(res.status, "end_lesson");
  return false;
}

// === Student API ===

export function chooseSeat(
  lessonId: string,
  serialNumber: number,
  sid: string,
  deviceId: string,
  roomId = ""
): SeatResult | null {
  const startTime = Date.now();
  const res = http.post(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/choose_seat`,
    JSON.stringify({
      serial_number: serialNumber,
      sid: sid,
      device_id: deviceId,
      is_incognito: false,
    }),
    {
      headers: getHeaders(),
      tags: { name: "choose_seat", room: roomId },
      timeout: "30s",
    }
  );

  seatTime.add(Date.now() - startTime);

  if (
    check(res, {
      "seat chosen": (r: RefinedResponse<ResponseType>) =>
        r.status === 200 || r.status === 201,
    })
  ) {
    httpSuccess.chooseSeat.add(1);
    roomStudentsSeated.add(1);
    wsConnection.seatChosen.add(1);
    const data = res.json() as { student_id: string; socket_token: string };
    return { studentId: data.student_id, token: data.socket_token };
  }
  if (roomId) console.error(`[Room ${roomId}] Seat failed: ${res.status}`);
  recordHttpError(res.status, "choose_seat");
  return null;
}

// === Quiz API ===

export function createQuizzes(lessonId: string): string | null {
  const payload = {
    quizzes: [
      {
        source_type: "QUIZ_GENERATOR",
        img_url: "",
        option_type: "TRUE_FALSE",
        collection_id: CONFIG.COLLECTION_ID,
        quiz_type: "TRUE_FALSE",
        content: "Test question 1",
        seq: 1,
        option_list: [
          {
            option_id: 1,
            content: "True",
            is_ai_answer: true,
            is_answer: true,
          },
          { option_id: 2, content: "False", is_ai_answer: false },
        ],
      },
      {
        source_type: "QUIZ_GENERATOR",
        img_url: "",
        option_type: "ALPHABET",
        collection_id: CONFIG.COLLECTION_ID,
        quiz_type: "SINGLE_SELECT",
        content: "Test question 2",
        seq: 2,
        option_list: [
          { option_id: 1, content: "A", is_ai_answer: false, is_answer: false },
          { option_id: 2, content: "B", is_ai_answer: true, is_answer: true },
          { option_id: 3, content: "C", is_ai_answer: false, is_answer: false },
        ],
      },
    ],
  };

  const res = http.post(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/quizzes/batch_quizzes`,
    JSON.stringify(payload),
    {
      headers: getHeaders(CONFIG.TEACHER_TOKEN),
      tags: { name: "create_quizzes" },
      timeout: "30s",
    }
  );

  if (res.status === 200 || res.status === 201) {
    httpSuccess.createQuizzes.add(1);
    const data = res.json() as {
      data?: { batch_quizzes_id: string };
      batch_quizzes_id?: string;
      id?: string;
    };
    return (
      data.data?.batch_quizzes_id || data.batch_quizzes_id || data.id || null
    );
  }
  console.error(`Failed to create quizzes: ${res.status}`);
  recordHttpError(res.status, "create_quizzes");
  return null;
}

export function fetchQuiz(
  lessonId: string,
  studentId: string
): QuizResponse | null {
  const res = http.get(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/students/${studentId}/batch_quizzes/latest`,
    { headers: getHeaders(), tags: { name: "fetch_quiz" } }
  );

  if (res.status === 200) {
    httpSuccess.fetchQuiz.add(1);
    return res.json() as QuizResponse;
  }
  recordHttpError(res.status, "fetch_quiz");
  return null;
}

export function submitAnswers(
  batchId: string,
  studentId: string,
  quizData: QuizResponse
): boolean {
  const startTime = Date.now();
  const quizzes = quizData.data?.quizzes || quizData.quizzes || [];

  if (quizzes.length === 0) return false;

  const answers: Answer[] = quizzes.map((q) => ({
    quiz_id: q.quiz_id,
    answer_data: q.option_list?.length > 0 ? [1] : [],
  }));

  const res = http.put(
    `${CONFIG.API_URL}/api/v3/quizzes/batch_quizzes/${batchId}/batch_quizzes_result`,
    JSON.stringify({ student_id: studentId, answers }),
    { headers: getHeaders(), tags: { name: "submit_answers" } }
  );

  submitTime.add(Date.now() - startTime);

  if (
    check(res, {
      "answers submitted": (r: RefinedResponse<ResponseType>) =>
        r.status === 200 || r.status === 201,
    })
  ) {
    httpSuccess.submitAnswers.add(1);
    return true;
  }
  recordHttpError(res.status, "submit_answers");
  return false;
}

export function finishQuiz(lessonId: string, batchId: string): boolean {
  const res = http.put(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/quizzes/batch_quizzes/${batchId}`,
    JSON.stringify({ status: "FINISH" }),
    { headers: getHeaders(CONFIG.TEACHER_TOKEN), tags: { name: "finish_quiz" } }
  );
  if (
    check(res, {
      "quiz finished": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.finishQuiz.add(1);
    return true;
  }
  recordHttpError(res.status, "finish_quiz");
  return false;
}

export function closeQuiz(lessonId: string, batchId: string): boolean {
  const res = http.put(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/quizzes/batch_quizzes/${batchId}`,
    JSON.stringify({ status: "CLOSE" }),
    { headers: getHeaders(CONFIG.TEACHER_TOKEN), tags: { name: "close_quiz" } }
  );
  if (
    check(res, {
      "quiz closed": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.closeQuiz.add(1);
    return true;
  }
  recordHttpError(res.status, "close_quiz");
  return false;
}

export function discloseQuiz(lessonId: string, batchId: string): boolean {
  const res = http.put(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/quizzes/batch_quizzes/${batchId}/disclose`,
    null,
    {
      headers: getHeaders(CONFIG.TEACHER_TOKEN),
      tags: { name: "disclose_quiz" },
    }
  );
  if (
    check(res, {
      "quiz disclosed": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.discloseQuiz.add(1);
    return true;
  }
  recordHttpError(res.status, "disclose_quiz");
  return false;
}

interface StudentPoints {
  student_id: string;
  points: number;
}

export function addStudentPoints(
  lessonId: string,
  students: StudentPoints[]
): boolean {
  const res = http.put(
    `${CONFIG.API_URL}/api/v3/lessons/${lessonId}/batch_points`,
    JSON.stringify({ students }),
    { headers: getHeaders(CONFIG.TEACHER_TOKEN), tags: { name: "add_points" } }
  );
  if (
    check(res, {
      "points added": (r: RefinedResponse<ResponseType>) => r.status === 200,
    })
  ) {
    httpSuccess.addPoints.add(1);
    return true;
  }
  recordHttpError(res.status, "add_points");
  return false;
}
