# K6 Load Testing Dashboard 欄位說明

本文件說明 Grafana Dashboard (`k6-influxdb-dashboard.json`) 中各面板與指標的意義。

> **資料來源：** InfluxDB（k6 在 commit `2034b62` 後已從 Prometheus 切換至 InfluxDB）。
> Prometheus dashboard (`k6-prometheus-dashboard.json`) 仍保留作為參考，但已非主要 dashboard。

---

## 一、Overview（概覽區塊）

| 面板名稱 | InfluxDB Measurement | 說明 |
|---------|---------------------|------|
| **Students Connected** | `ws_join_lesson_sent` | 已連線並送出 join_lesson 的學生總數 |
| **Students Seated** | `ws_seat_chosen` | 已選擇座位的學生總數 |
| **Answers Submitted** | `http_success_submit_answers` | 成功提交答案的總次數 |
| **Events Received** | `ws_event_quiz_created` | 學生收到的 quiz_created 事件總數 |
| **Errors** | `http_error_500` | HTTP 500 錯誤總數（紅色警示） |
| **HTTP Requests** | `http_reqs` | k6 內建 HTTP 請求總數 |

---

## 二、Test Flow（測試流程區塊）

### Event Summary（bargauge）

一覽所有 WebSocket 事件累計數，用於確認測試流程是否完整。

| Alias | InfluxDB Measurement | 說明 |
|-------|---------------------|------|
| `ws_connected` | `ws_connected` | WebSocket TCP 握手成功 |
| `namespace_connected` | `ws_namespace_connected` | Socket.IO Namespace 加入成功 |
| `seat_chosen` | `ws_seat_chosen` | 選座 API 成功 |
| `join_lesson` | `ws_join_lesson_sent` | 學生發送 join_lesson |
| `teacher_join` | `ws_teacher_join_lesson_sent` | 老師發送 join_lesson |
| `quiz_created` | `ws_event_quiz_created` | 學生收到 Quiz 建立事件 |
| `student_submitted` | `ws_event_student_submitted` | 老師收到學生提交事件 |
| `quiz_finished` | `ws_event_quiz_finished` | 收到 Quiz 結束事件 |
| `quiz_disclosed` | `ws_event_quiz_disclosed` | 收到 Quiz 公布事件 |
| `quiz_closed` | `ws_event_quiz_closed` | 收到 Quiz 關閉事件 |
| `end_lesson` | `ws_event_end_lesson` | 收到課程結束事件 |
| `ws_disconnected` | `ws_disconnected` | WebSocket 正常斷線 |
| `unexpected_close` | `ws_unexpected_close` | WebSocket 非預期斷線（橘色警示） |
| `connection_error` | `ws_connection_error` | WebSocket 連線錯誤（紅色警示） |

### Events Over Time（timeseries）

同樣的 measurement，但用 `cumulative_sum(sum("value"))` + `GROUP BY time(1s) fill(0)` 畫成累積曲線，可看出事件投遞的時間分佈。

---

## 三、Performance（效能區塊）

### HTTP Request Duration by API（p95 timeseries，單位 ms）

從 `http_req_duration` 拉出特定 API 名稱的 p95 延遲：

```sql
SELECT percentile("value", 95) FROM "http_req_duration"
WHERE "name"='<api_name>' AND $timeFilter
GROUP BY time(10s) fill(none)
```

| API 名稱 | 說明 |
|---------|------|
| `choose_seat` | 選擇座位 |
| `submit_answers` | 提交答案 |
| `fetch_quiz` | 取得測驗 |
| `create_quizzes` | 建立測驗 |
| `create_room` | 建立房間 |
| `create_lesson` | 建立課程 |
| `start_lesson` | 開始課程 |
| `end_lesson` | 結束課程 |
| `finish_quiz` | 完成測驗 |
| `disclose_quiz` | 公布答案 |
| `close_quiz` | 關閉測驗 |

### WS Handshake p95（stat，單位 ms）

```sql
SELECT percentile("value", 95) FROM "ws_connecting" WHERE $timeFilter
```

`ws_connecting` 是 k6 內建的 WebSocket 握手時間 metric。閾值：< 500ms 綠、500–1000ms 黃、> 1000ms 紅。

---

## 四、Event Delivery（事件投遞區塊）

衡量 API 呼叫 → WS event 投遞到接收方的延遲。每個 metric 同時記錄發送方與接收方的絕對時間戳（`Date.now()`），Grafana 用 `spread() = max - min` 計算 delivery time。多 room 時 `GROUP BY "room"` 並取最慢的那間。

| Alias | InfluxDB Measurement | 方向 |
|-------|---------------------|------|
| `quiz_created` | `delivery_quiz_created` | Teacher → Students |
| `student_submitted` | `delivery_student_submitted` | Students → Teacher |
| `quiz_finished` | `delivery_quiz_finished` | Teacher → Students |
| `quiz_disclosed` | `delivery_quiz_disclosed` | Teacher → Students |
| `quiz_closed` | `delivery_quiz_closed` | Teacher → Students |
| `lesson_end` | `delivery_lesson_end` | Teacher → Students |

閾值：< 3000ms 綠、3000–10000ms 黃、> 10000ms 紅。

> **InfluxDB tag 設計：** 所有 `.add()` 呼叫都帶有 `{ room, student }` 或 `{ room, role, student }` 標籤，避免 InfluxDB 時間戳碰撞（多個 VU 在同一微秒寫入相同 measurement + tagset 會被覆蓋）。

---

## 五、Errors（錯誤區塊）

### HTTP Errors by Status Code（bargauge）

| Alias | InfluxDB Measurement | 說明 |
|-------|---------------------|------|
| `400` | `http_error_400` | Bad Request |
| `401` | `http_error_401` | Unauthorized |
| `403` | `http_error_403` | Forbidden |
| `404` | `http_error_404` | Not Found |
| `409` | `http_error_409` | Conflict |
| `500` | `http_error_500` | Internal Server Error |
| `503` | `http_error_503` | Service Unavailable |
| `seat_409` | `seat_error_409` | 選座衝突（特殊追蹤） |

閾值：0 綠、≥1 黃、≥5 紅。

> 完整 error counter 還包含 `http_error_402/422/429/502/504/timeout/other` 與 `seat_error_xxx` 系列，定義於 `src/lib/metrics.ts`，但目前 dashboard 只呈現上表這幾個常見的。

---

## 儀表板設定

| 設定項目 | 值 |
|---------|---|
| **自動重新整理** | 每 5 秒 |
| **預設時間範圍** | 最近 15 分鐘 |
| **資料來源** | InfluxDB（透過 `${DS_INFLUXDB}` 變數選擇） |
| **標籤** | k6, influxdb, load-testing |
| **Schema 版本** | 39 |
