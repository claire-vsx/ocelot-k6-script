# K6 Classroom Stress Test

ClassSwift 教室系統壓力測試腳本，使用 K6 + TypeScript 編寫。

## 專案結構

```
ocelot-k6-script/
├── src/
│   ├── lib/                    # 共用模組
│   │   ├── types.ts           # 型別定義
│   │   ├── config.ts          # 環境變數設定
│   │   ├── metrics.ts         # K6 Metrics
│   │   ├── socketio.ts        # Socket.IO 協議工具
│   │   ├── api.ts             # HTTP API 函數
│   │   └── index.ts           # 模組匯出
│   └── scenarios/              # 測試場景
│       ├── multi-room.ts      # 多教室壓力測試
│       └── single-room.ts     # 單教室測試
├── monitoring/                 # 監控配置
│   ├── docker-compose.yml     # Prometheus + Grafana
│   ├── prometheus.yml         # Prometheus 設定
│   ├── k6-prometheus-dashboard.json  # Grafana Dashboard
│   └── provisioning/          # Grafana 自動配置
│       ├── dashboards/
│       └── datasources/
├── dist/                       # 編譯輸出 (git ignored)
├── .env.example               # 環境變數範例
├── .env.local                 # 本地環境變數 (git ignored)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 快速開始

### 1. 安裝依賴

```bash
# 安裝 K6
brew install k6

# 安裝 Node 依賴
pnpm install
```

### 2. 設定環境變數

```bash
# 複製範例檔案
cp .env.example .env.local

# 編輯 .env.local 填入實際值
vim .env.local
```

### 3. 編譯 TypeScript

```bash
pnpm build
```

### 4. 執行測試

```bash
# 載入環境變數並執行測試
source .env.local && k6 run dist/multi-room.js

# 或使用 pnpm script (需先 source .env.local)
source .env.local && pnpm test:multi-room
```

**或直接指定環境變數：**

```bash
NUM_ROOMS=2 TEACHER_TOKEN=xxx ORG_ID=xxx k6 run dist/multi-room.js
```

## 測試場景

### Multi-Room (多教室壓力測試)

模擬多間教室同時進行課程，每間教室有 1 位老師和 N 位學生。

**環境變數：**

| 變數                   | 必填 | 預設值                | 說明                   |
| ---------------------- | ---- | --------------------- | ---------------------- |
| `NUM_ROOMS`            | ✅   | -                     | 教室數量               |
| `STUDENTS_PER_ROOM`    | -    | 50                    | 每間教室學生數         |
| `TEACHER_TOKEN`        | ✅   | -                     | 老師 JWT Token         |
| `TEACHER_WS_TOKEN`     | ✅   | -                     | 老師 WebSocket Token   |
| `ORG_ID`               | ✅   | -                     | 組織 ID                |
| `TEACHER_ID`           | -    | 同 ORG_ID             | 老師 ID                |
| `API_URL`              | -    | http://localhost:8000 | API URL                |
| `SOCKET_URL`           | -    | 同 API_URL            | WebSocket URL          |
| `COLLECTION_ID`        | -    | -                     | Quiz Collection ID     |
| `DISPLAY_NAME`         | -    | Teacher               | 老師顯示名稱           |
| `REGION`               | -    | TW                    | 地區代碼               |
| `TEACHER_DELAY`        | -    | 30                    | 老師延遲啟動秒數       |
| `STUDENT_SESSION_TIME` | -    | 90                    | 學生 Session 持續秒數  |

**執行方式：**

```bash
NUM_ROOMS=4 TEACHER_TOKEN=xxx TEACHER_WS_TOKEN=xxx ORG_ID=xxx k6 run dist/multi-room.js
```

### Single-Room (單教室測試)

單一教室測試，使用雙場景架構（學生 + 教師分離）。

**環境變數：**

| 變數                | 必填 | 預設值                | 說明                           |
| ------------------- | ---- | --------------------- | ------------------------------ |
| `ROOM_ID`           | ✅   | -                     | 教室 ID                        |
| `TEACHER_TOKEN`     | ✅   | -                     | 老師 JWT Token                 |
| `TEACHER_WS_TOKEN`  | ✅   | -                     | 老師 WebSocket Token           |
| `ORG_ID`            | ✅   | -                     | 組織 ID                        |
| `NUM_STUDENTS`      | -    | 50                    | 學生數量                       |
| `TEACHER_DELAY`     | -    | 10                    | 老師延遲啟動秒數               |
| `STUDENT_WAIT_TIME` | -    | 60                    | 學生等待 Quiz 超時秒數         |
| `API_URL`           | -    | http://localhost:8000 | API URL                        |
| `SOCKET_URL`        | -    | 同 API_URL            | WebSocket URL                  |
| `COLLECTION_ID`     | -    | -                     | Quiz Collection ID             |
| `DISPLAY_NAME`      | -    | Teacher               | 老師顯示名稱                   |
| `REGION`            | -    | TW                    | 地區代碼                       |

**執行方式：**

```bash
ROOM_ID=xxx TEACHER_TOKEN=xxx TEACHER_WS_TOKEN=xxx ORG_ID=xxx k6 run dist/single-room.js
```

## 測試流程時間軸

### Multi-Room 流程

```
t=0s     Setup: 建立 N 間教室
         │
         ├── Room 1 ──────────────────────────────────────────────────────►
         │   t=0s: Teacher 建立 Lesson → 啟動 Lesson → 連線 WebSocket
         │   t=30s: Students 開始連線 → 選座位 → 加入課程
         │   t=75s: Teacher 建立 Quiz
         │   t=76-150s: Students 收到 Quiz → 提交答案
         │   t=155s: Teacher 結束 Quiz → 公開 Quiz → 關閉 Quiz → 結束課程
         │
         ├── Room 2 ──────────────────────────────────────────────────────►
         │   (同上，並行執行)
         │
         └── Room N ...
```

### Single-Room 流程

```
t=0s     Setup: 建立 Lesson
         │
         ├── Students (50 VUs) ────────────────────────────────────────────►
         │   t=0-3s: 錯開連線 → WebSocket 連線 → 選座位 → 加入課程
         │   t=12s: 收到 Quiz → 思考 → 提交答案
         │   t=60s: Timeout 斷線
         │
         └── Teacher (1 VU) ───────────────────────────────────────────────►
             t=10s: 延遲啟動 → 連線 WebSocket → 加入課程
             t=12s: 建立 Quiz
             t=52s: 結束 Quiz → 公開 Quiz → 關閉 Quiz → 結束課程
```

## 開發指南

### 編譯並監聽變更

```bash
pnpm build:watch
```

### 型別檢查

```bash
pnpm typecheck
```

### 新增測試場景

1. 在 `src/scenarios/` 建立新的 `.ts` 檔案
2. 在 `vite.config.ts` 的 `entry` 加入新場景
3. 執行 `pnpm build`

## 監控 (Prometheus + Grafana)

### 1. 啟動監控服務

```bash
# 使用 pnpm script
pnpm monitoring:up

# 或手動啟動
cd monitoring && docker compose up -d
```

### 2. 執行測試並輸出到 Prometheus

```bash
# 載入環境變數 (包含 K6_PROMETHEUS_RW_SERVER_URL)
source .env.local

# 執行測試並輸出到 Prometheus
pnpm test:multi-room:prometheus

# 或手動執行
k6 run --out experimental-prometheus-rw dist/multi-room.js
```

**環境變數說明：**

| 變數                                         | 說明                        | 預設值                             |
| -------------------------------------------- | --------------------------- | ---------------------------------- |
| `K6_PROMETHEUS_RW_SERVER_URL`                | Prometheus Remote Write URL | http://localhost:9090/api/v1/write |
| `K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM` | 使用原生直方圖              | true                               |

**Prometheus 原生直方圖說明：**

K6 使用原生直方圖格式輸出 Trend 指標，查詢時需使用 `histogram_quantile()` 函數：

```promql
# 查詢 p95 範例
histogram_quantile(0.95, sum by (le) (k6_http_req_duration_seconds{name="choose_seat"})) * 1000

# 查詢自訂 Trend 指標
histogram_quantile(0.95, sum by (le) (k6_seat_time))
```

### 3. 查看 Dashboard

- **Grafana**: http://localhost:3000 (admin/admin)
  - Dashboard 已自動載入：`k6 Load Testing (Prometheus)`
  - Prometheus datasource 已自動配置
- **Prometheus**: http://localhost:9090

### 4. 停止監控服務

```bash
pnpm monitoring:down
```

## 關鍵指標

### 核心指標 (Rate)

| 指標                | 說明             | 目標  |
| ------------------- | ---------------- | ----- |
| `student_connected` | 學生連線成功率   | > 90% |
| `student_seated`    | 學生選座成功率   | > 90% |
| `seat_within_3s`    | 3 秒內選座成功率 | > 95% |
| `answers_submitted` | 答案提交成功率   | > 80% |
| `teacher_connected` | 老師連線成功率   | > 90% |
| `events_received`   | WebSocket 事件接收率 | > 90% |

### 時間指標 (Trend)

| 指標                    | 說明                  | 目標     |
| ----------------------- | --------------------- | -------- |
| `seat_time`             | 選座 HTTP 請求時間    | < 3000ms |
| `submit_time`           | 提交答案 HTTP 請求時間 | < 3000ms |
| `time_to_seat`          | 總選座時間            | < 3000ms |
| `ws_connect_time`       | WebSocket 連線時間    | < 500ms  |
| `ws_connecting_time`    | WebSocket 建立連線時間 | < 500ms  |
| `quiz_received_time`    | 收到 Quiz 事件時間    | -        |
| `ws_connection_duration`| WebSocket 連線持續時間 | -        |

### HTTP 指標

| 指標                                    | 說明                | 目標     |
| --------------------------------------- | ------------------- | -------- |
| `http_req_duration{name:choose_seat}`   | 選座請求 95% 時間   | < 3000ms |
| `http_req_duration{name:submit_answers}`| 提交答案 95% 時間   | < 3000ms |
| `http_req_failed`                       | HTTP 請求失敗率     | < 10%    |

### WebSocket 事件計數 (Counter)

| 指標                        | 說明                     |
| --------------------------- | ------------------------ |
| `ws_event_quiz_created`     | Quiz 建立事件數          |
| `ws_event_quiz_finished`    | Quiz 結束事件數          |
| `ws_event_quiz_disclosed`   | Quiz 公開事件數          |
| `ws_event_quiz_closed`      | Quiz 關閉事件數          |
| `ws_event_end_lesson`       | 課程結束事件數           |
| `ws_event_student_submitted`| 學生提交答案事件數       |

### WebSocket 連線狀態 (Counter)

| 指標                      | 說明                      |
| ------------------------- | ------------------------- |
| `ws_connected`            | WebSocket 連線成功數      |
| `ws_disconnected`         | WebSocket 正常斷線數      |
| `ws_unexpected_close`     | WebSocket 非預期斷線數    |
| `ws_connection_error`     | WebSocket 連線錯誤數      |
| `ws_namespace_connected`  | Socket.IO Namespace 連線數 |

### HTTP 成功計數 (Counter)

| 指標                         | 說明             |
| ---------------------------- | ---------------- |
| `http_success_create_room`   | 建立教室成功數   |
| `http_success_create_lesson` | 建立課程成功數   |
| `http_success_choose_seat`   | 選座成功數       |
| `http_success_create_quizzes`| 建立 Quiz 成功數 |
| `http_success_submit_answers`| 提交答案成功數   |
| `http_success_finish_quiz`   | 結束 Quiz 成功數 |
| `http_success_disclose_quiz` | 公開 Quiz 成功數 |
| `http_success_close_quiz`    | 關閉 Quiz 成功數 |
| `http_success_end_lesson`    | 結束課程成功數   |

## 測試結果範例

```
     ✓ seat chosen
     ✓ answers submitted

     checks.........................: 100.00% ✓ 150  ✗ 0

   ✓ student_connected..............: 100.00% ✓ 50   ✗ 0
   ✓ student_seated.................: 100.00% ✓ 50   ✗ 0
   ✓ seat_within_3s.................: 98.00%  ✓ 49   ✗ 1
   ✓ answers_submitted..............: 100.00% ✓ 50   ✗ 0

     seat_time......................: avg=120ms min=50ms max=500ms p(95)=300ms
     ws_connect_time................: avg=80ms  min=30ms max=200ms p(95)=150ms
```

## 常見問題

### Q: 編譯失敗？

確認已安裝依賴：

```bash
pnpm install
```

### Q: K6 執行失敗？

確認 K6 已安裝：

```bash
k6 version
```

### Q: WebSocket 連線失敗？

檢查 `SOCKET_URL` 環境變數是否正確設定。

### Q: 如何增加學生數量？

```bash
STUDENTS_PER_ROOM=100 NUM_ROOMS=4 k6 run dist/multi-room.js
```
