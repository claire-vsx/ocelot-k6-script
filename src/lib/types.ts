/**
 * 共用型別定義
 */

// === 配置型別 ===
export interface Config {
    API_URL: string;
    SOCKET_URL: string;
    TEACHER_TOKEN: string;
    TEACHER_WS_TOKEN: string;
    ORG_ID: string;
    TEACHER_ID: string;
    DISPLAY_NAME: string;
    REGION: string;
    ROOM_ID: string;
    COLLECTION_ID: string;
    STUDENT_SESSION_TIME: number;
    TEACHER_DELAY: number;
    STUDENT_WAIT_TIME: number;
    STUDENT_WAIT_FOR_TEACHER: number;
    STUDENT_RANDOM_DELAY_MAX: number;
}

// === API 回應型別 ===
export interface RoomResponse {
    data?: {
        room_id: string;
    };
    room_id?: string;
}

export interface LessonResponse {
    data?: {
        lesson_id: string;
    };
    lesson_id?: string;
    id?: string;
}

export interface SeatResponse {
    student_id: string;
    socket_token: string;
}

export interface QuizResponse {
    data?: {
        quizzes: Quiz[];
        batch_quizzes_id?: string;
    };
    quizzes?: Quiz[];
    batch_quizzes_id?: string;
    id?: string;
}

export interface Quiz {
    quiz_id: string;
    quiz_type: 'TRUE_FALSE' | 'SINGLE_SELECT' | 'MULTI_SELECT';
    content: string;
    option_list: QuizOption[];
}

export interface QuizOption {
    option_id: number;
    content: string;
    is_ai_answer?: boolean;
    is_answer?: boolean;
}

export interface Answer {
    quiz_id: string;
    answer_data: number[];
}

// === Socket.IO 型別 ===
export type SocketMessageType = 'open' | 'ping' | 'pong' | 'connect' | 'event';

export interface ParsedMessage {
    type: SocketMessageType;
    namespace?: string;
    data?: Record<string, unknown>;
    event?: string;
}

export interface JoinLessonPayload {
    lesson_id: string;
    user_id: string;
    role: 'student' | 'teacher';
    access_token: string;
}

export interface QuizCreatedEvent {
    batch_quizzes_id: string;
}

// === Seat 結果 ===
export interface SeatResult {
    studentId: string;
    token: string;
}

