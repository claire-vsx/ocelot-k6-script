# K6 Load Testing Dashboard 欄位說明

本文件說明 Grafana Dashboard (`k6-prometheus-dashboard.json`) 中各面板與指標的意義。

---

## 一、Overview（概覽區塊）

| 面板名稱 | 指標 | 說明 |
|---------|------|------|
| **Students Connected** | `k6_ws_join_lesson_sent_total` | 已連線並加入課程的學生總數 |
| **Students Seated** | `k6_ws_seat_chosen_total` | 已選擇座位的學生總數 |
| **Answers Submitted** | `k6_http_success_submit_answers_total` | 成功提交答案的總次數 |
| **Events Received** | `k6_ws_event_quiz_created_total` | 收到的測驗建立事件總數 |
| **Errors** | `k6_errors_total` | 錯誤總數（紅色警示） |
| **HTTP Requests** | `k6_http_reqs_total` | HTTP 請求總數 |

---

## 二、WebSocket Events（WebSocket 事件區塊）

### Socket Events Summary（事件摘要長條圖）

| 指標名稱 | 說明 |
|---------|------|
| `ws_connected` | WebSocket 連線成功次數 |
| `namespace_connected` | 命名空間連線成功次數 |
| `seat_chosen` | 選擇座位事件次數 |
| `join_lesson` | 學生加入課程次數 |
| `teacher_join` | 教師加入課程次數 |
| `quiz_created` | 測驗建立事件次數 |
| `quiz_finished` | 測驗結束事件次數 |
| `quiz_disclosed` | 測驗公佈答案事件次數 |
| `quiz_closed` | 測驗關閉事件次數 |
| `student_submitted` | 學生提交答案事件次數 |
| `end_lesson` | 課程結束事件次數 |
| `ws_disconnected` | WebSocket 斷線次數 |

---

## 三、HTTP Performance（HTTP 效能區塊）

### HTTP Request Duration（請求延遲時間 - P99）

| API 名稱 | 說明 |
|---------|------|
| `create_room` | 建立房間 API 延遲 |
| `create_lesson` | 建立課程 API 延遲 |
| `start_lesson` | 開始課程 API 延遲 |
| `end_lesson` | 結束課程 API 延遲 |
| `choose_seat` | 選擇座位 API 延遲 |
| `create_quizzes` | 建立測驗 API 延遲 |
| `fetch_quiz` | 取得測驗 API 延遲 |
| `submit_answers` | 提交答案 API 延遲 |
| `finish_quiz` | 完成測驗 API 延遲 |
| `close_quiz` | 關閉測驗 API 延遲 |
| `disclose_quiz` | 公佈測驗答案 API 延遲 |
| `add_points` | 加分 API 延遲 |

### HTTP Requests Rate（每秒請求數）

顯示各 API 的每秒請求速率（req/s），包含：

- `total_requests/s` - 總請求速率
- `failed_requests/s` - 失敗請求速率
- 各 API 個別速率

---

## 四、Custom Metrics（自定義指標區塊）

### Custom Timing Metrics（自定義時間指標）

| 指標名稱 | 說明 |
|---------|------|
| `choose_seat p99` | 選擇座位操作的 P99 延遲時間 |
| `submit_answers p99` | 提交答案操作的 P99 延遲時間 |
| `quiz_received p99` | 收到測驗的 P99 延遲時間 |
| `time_to_seat p99` | 從連線到入座的 P99 總時間 |

### WebSocket Timing（WebSocket 時間指標）

| 指標名稱 | 說明 |
|---------|------|
| `ws_connect p99` | WebSocket 連線建立的 P99 時間 |
| `connection_duration p99` | 連線持續時間的 P99 值 |
| `ws_connecting p99` | WebSocket 連線中狀態的 P99 時間 |

### WebSocket Connection Lifecycle（連線生命週期）

追蹤完整的 WebSocket 連線狀態變化，包含：

- `connected` / `namespace_connected` - 連線狀態
- `unexpected_close` - 意外斷線次數
- `connection_error` - 連線錯誤次數

---

## 五、HTTP Success（HTTP 成功統計區塊）

顯示各 API 成功呼叫的總次數：

| API | 說明 |
|-----|------|
| `create_room` | 建立房間成功次數 |
| `create_lesson` | 建立課程成功次數 |
| `start_lesson` | 開始課程成功次數 |
| `choose_seat` | 選擇座位成功次數 |
| `fetch_quiz` | 取得測驗成功次數 |
| `submit_answers` | 提交答案成功次數 |
| `create_quizzes` | 建立測驗成功次數 |
| `finish_quiz` | 完成測驗成功次數 |
| `disclose_quiz` | 公佈答案成功次數 |
| `close_quiz` | 關閉測驗成功次數 |
| `end_lesson` | 結束課程成功次數 |

---

## 六、HTTP Errors（HTTP 錯誤統計區塊）

依 HTTP 狀態碼分類的錯誤統計：

| 狀態碼 | 說明 |
|-------|------|
| `400` | Bad Request - 請求格式錯誤 |
| `401` | Unauthorized - 未授權 |
| `403` | Forbidden - 禁止存取 |
| `404` | Not Found - 資源不存在 |
| `409` | Conflict - 資源衝突 |
| `500` | Internal Server Error - 伺服器內部錯誤 |
| `seat_409` | 座位衝突錯誤（特殊追蹤） |

---

## 儀表板設定

| 設定項目 | 值 |
|---------|---|
| **自動重新整理** | 每 5 秒 |
| **預設時間範圍** | 最近 5 分鐘 |
| **資料來源** | Prometheus |
| **標籤** | k6, prometheus, load-testing |
