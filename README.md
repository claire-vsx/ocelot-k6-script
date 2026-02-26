# K6 Classroom Load Test

ClassSwift 教室系統負載測試腳本，使用 K6 + TypeScript 編寫。

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
│       ├── multi-room.ts           # 多教室壓力測試
│       ├── specified-one-room.ts   # 指定教室測試
│       ├── load-test.ts            # 長時間負載測試
│       └── stress-test.ts          # 階梯式壓力測試
├── monitoring/                 # 監控配置
│   ├── docker-compose.yml     # Prometheus + Grafana
│   ├── prometheus.yml         # Prometheus 設定
│   ├── k6-influxdb-dashboard.json    # Grafana Dashboard (InfluxDB)
│   ├── k6-prometheus-dashboard.json  # Grafana Dashboard (Prometheus)
│   ├── DASHBOARD_FIELDS.md    # Dashboard 欄位說明
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

| 變數                   | 必填 | 預設值                | 說明                  |
| ---------------------- | ---- | --------------------- | --------------------- |
| `NUM_ROOMS`            | ✅   | -                     | 教室數量              |
| `STUDENTS_PER_ROOM`    | -    | 50                    | 每間教室學生數        |
| `TEACHER_TOKEN`        | ✅   | -                     | 老師 JWT Token        |
| `TEACHER_WS_TOKEN`     | ✅   | -                     | 老師 WebSocket Token  |
| `ORG_ID`               | ✅   | -                     | 組織 ID               |
| `TEACHER_ID`           | -    | 同 ORG_ID             | 老師 ID               |
| `API_URL`              | -    | http://localhost:8000 | API URL               |
| `SOCKET_URL`           | -    | 同 API_URL            | WebSocket URL         |
| `COLLECTION_ID`        | -    | -                     | Quiz Collection ID    |
| `DISPLAY_NAME`         | -    | Teacher               | 老師顯示名稱          |
| `REGION`               | -    | TW                    | 地區代碼              |
| `TEACHER_DELAY`        | -    | 30                    | 老師延遲啟動秒數      |
| `STUDENT_SESSION_TIME` | -    | 90                    | 學生 Session 持續秒數 |

**執行方式：**

```bash
# 直接指定環境變數
NUM_ROOMS=4 TEACHER_TOKEN=xxx TEACHER_WS_TOKEN=xxx ORG_ID=xxx k6 run dist/multi-room.js

# 使用 .env.local 輸出到 InfluxDB
source .env.local && pnpm test:multi-room:influxdb
# 或手動執行
source .env.local && k6 run --out influxdb=${K6_INFLUXDB_ADDR}/k6 dist/multi-room.js
```

### Specified-One-Room (指定教室測試)

指定現有教室進行測試，使用雙場景架構（學生 + 教師分離）。適用於測試特定教室或已存在的教室環境。

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
# 直接指定環境變數
ROOM_ID=xxx TEACHER_TOKEN=xxx TEACHER_WS_TOKEN=xxx ORG_ID=xxx k6 run dist/specified-one-room.js

# 使用 .env.local 輸出到 InfluxDB
source .env.local && pnpm test:specified-one-room:influxdb
```

### Load-Test (長時間負載測試)

模擬真實課堂情境，課程持續 30-45 分鐘，老師多次發送測驗。適用於長時間穩定性測試。

**環境變數：**

| 變數                | 必填 | 預設值                | 說明                   |
| ------------------- | ---- | --------------------- | ---------------------- |
| `NUM_ROOMS`         | ✅   | -                     | 教室數量               |
| `STUDENTS_PER_ROOM` | -    | 50                    | 每間教室學生數         |
| `LESSON_DURATION`   | -    | 30                    | 課程時長（分鐘）       |
| `QUIZ_COUNT`        | -    | 5                     | 測驗次數               |
| `QUIZ_INTERVAL`     | -    | 5                     | 測驗間隔（分鐘）       |
| `TEACHER_TOKEN`     | ✅   | -                     | 老師 JWT Token         |
| `TEACHER_WS_TOKEN`  | ✅   | -                     | 老師 WebSocket Token   |
| `ORG_ID`            | ✅   | -                     | 組織 ID                |
| `API_URL`           | -    | http://localhost:8000 | API URL                |
| `SOCKET_URL`        | -    | 同 API_URL            | WebSocket URL          |
| `COLLECTION_ID`     | -    | -                     | Quiz Collection ID     |

**執行方式：**

```bash
# 直接指定環境變數（30 分鐘課程，5 次測驗）
NUM_ROOMS=2 LESSON_DURATION=30 QUIZ_COUNT=5 TEACHER_TOKEN=xxx ORG_ID=xxx k6 run dist/load-test.js

# 使用 .env.local 輸出到 InfluxDB
source .env.local && pnpm test:load-test:influxdb
```

### Stress-Test (階梯式壓力測試)

逐步增加負載找出系統極限，用於找出系統 breaking point、測試 auto-scaling 行為、驗證 graceful degradation。

**測試架構：**
- 1 位老師持續連線（創建 Quiz、結束課程）
- 學生數量階梯式增加（ramping-vus）

**環境變數：**

| 變數                | 必填 | 預設值                | 說明                       |
| ------------------- | ---- | --------------------- | -------------------------- |
| `MAX_VUS`           | -    | 200                   | 最大虛擬用戶數（學生）     |
| `STAGES`            | -    | 5                     | 階段數量                   |
| `STAGE_DURATION`    | -    | 60s                   | 每階段持續時間             |
| `TEACHER_TOKEN`     | ✅   | -                     | 老師 JWT Token             |
| `TEACHER_WS_TOKEN`  | ✅   | -                     | 老師 WebSocket Token       |
| `ORG_ID`            | ✅   | -                     | 組織 ID                    |
| `API_URL`           | -    | http://localhost:8000 | API URL                    |
| `SOCKET_URL`        | -    | 同 API_URL            | WebSocket URL              |
| `COLLECTION_ID`     | -    | -                     | Quiz Collection ID         |

**階梯式負載模式：**

```
VUs
 ▲
200│                    ████
   │               ████
160│          ████
   │     ████
120│████
   │
 80│
   │                         ████████  (Recovery)
 40│
   │
  0└─────────────────────────────────────► Time
   │ 30s  60s  30s  60s ... 30s  60s  30s
   │ ramp  ↑   ramp  ↑      ramp down
```

**執行方式：**

```bash
# 預設配置（200 VUs，5 階段，每階段 60 秒）
source .env.local && k6 run dist/stress-test.js

# 自訂配置
MAX_VUS=500 STAGES=10 STAGE_DURATION=120s k6 run dist/stress-test.js

# 輸出到 InfluxDB
source .env.local && pnpm test:stress-test:influxdb
```

**專屬指標：**

| 指標               | 說明             | 目標   |
| ------------------ | ---------------- | ------ |
| `stress_connected` | 學生連線成功率   | > 50%  |
| `stress_seated`    | 學生選座成功率   | > 50%  |
| `stress_seat_time` | 選座時間         | -      |
| `teacher_connected`| 老師連線成功率   | 100%   |
| `quiz_created`     | Quiz 創建成功率  | 100%   |
| `lesson_ended`     | 課程結束成功率   | 100%   |

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

### Specified-One-Room 流程

```
t=0s     Setup: 在指定教室建立 Lesson
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

### Load-Test 流程

```
t=0s     Setup: 建立 Lesson
         │
         ├── Students (50 VUs) ────────────────────────────────────────────────────►
         │   t=0-3s: 錯開連線 → WebSocket 連線 → 選座位 → 加入課程
         │   t=2m:   收到 Quiz #1 → 思考 → 提交答案
         │   t=7m:   收到 Quiz #2 → 思考 → 提交答案
         │   t=12m:  收到 Quiz #3 → 思考 → 提交答案
         │   t=17m:  收到 Quiz #4 → 思考 → 提交答案
         │   t=22m:  收到 Quiz #5 → 思考 → 提交答案
         │   t=30m:  收到課程結束事件 → 斷線
         │
         └── Teacher (1 VU) ───────────────────────────────────────────────────────►
             t=10s:   延遲啟動 → 連線 WebSocket → 加入課程
             t=2m:    建立 Quiz #1
             t=6m30s: 結束 Quiz #1 → 公開 → 關閉
             t=7m:    建立 Quiz #2
             ...      (重複直到所有測驗完成)
             t=30m:   結束課程
```

### Stress-Test 流程

```
t=0s     Setup: 建立教室和課程
         │
         ├── Teacher (1 VU) ───────────────────────────────────────────────────────►
         │   t=0s:    連線 WebSocket → 加入課程
         │   t=30s:   建立 Quiz
         │   t=~9m:   結束 Quiz → 公開 → 關閉 → 結束課程
         │
         └── Students (ramping-vus) ───────────────────────────────────────────────►
             t=10s:   開始階梯式增加 VUs
             │
             │  Stage 1: 0 → 40 VUs (30s ramp) → 維持 60s
             │  Stage 2: 40 → 80 VUs (30s ramp) → 維持 60s
             │  Stage 3: 80 → 120 VUs (30s ramp) → 維持 60s
             │  Stage 4: 120 → 160 VUs (30s ramp) → 維持 60s
             │  Stage 5: 160 → 200 VUs (30s ramp) → 維持 60s
             │  Recovery: 200 → 50 VUs (30s) → 維持 60s → 50 → 0 (30s)
             │
             每個學生: 連線 → 選座位 → 加入課程 → 30 秒後斷線
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

## 監控 (InfluxDB + Grafana)

### 1. 執行測試並輸出到 InfluxDB

```bash
source .env.local

# 使用 pnpm script（自動 build + 輸出到 InfluxDB）
pnpm test:multi-room:influxdb

# 或手動執行
k6 run --out influxdb=${K6_INFLUXDB_ADDR}/k6 dist/multi-room.js
```

**環境變數說明：**

| 變數                       | 說明                  | 預設值                  |
| -------------------------- | --------------------- | ----------------------- |
| `K6_INFLUXDB_ADDR`         | InfluxDB 地址         | http://localhost:8086   |
| `K6_INFLUXDB_PUSH_INTERVAL`| 資料推送間隔          | 1s                      |

> **Push Interval 設為 1s** 是為了避免 InfluxDB 時間戳碰撞。較長的間隔會導致同一秒內多個 VU 的資料被聚合覆蓋。

### 2. 匯入 Grafana Dashboard

將 `monitoring/k6-influxdb-dashboard.json` 匯入 Grafana，並設定 InfluxDB datasource 指向 `k6` database。

**Dashboard 架構：**

| Section          | Panel                       | 說明                              |
| ---------------- | --------------------------- | --------------------------------- |
| Overview         | 6 個 stat                   | 連線數、選座數、提交數、事件數、錯誤數、HTTP 總數 |
| Test Flow        | Event Summary (bargauge)    | 所有 WS 事件計數一覽              |
|                  | Events Over Time (timeseries)| 事件累積曲線                      |
| Performance      | HTTP Request Duration       | 各 API p95 回應時間               |
|                  | WS Handshake p95 (stat)     | WebSocket 握手 95 百分位時間      |
| Event Delivery   | Event Delivery Time (bargauge)| API → WS event 的投遞延遲       |
| Errors           | HTTP Errors by Status Code  | HTTP 錯誤分佈                     |

### 3. 本地開發監控（Prometheus + Grafana）

如需在本地使用 Docker 起 Prometheus + Grafana：

```bash
pnpm monitoring:up    # 啟動
pnpm monitoring:down  # 停止
```

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090

## GitHub Actions CI/CD

支援透過 GitHub Actions 手動觸發測試，結果輸出到 InfluxDB。

### 使用方式

1. 到 GitHub repo → **Actions** → **K6 Load Test**
2. 點擊 **Run workflow**
3. 選擇參數：
   - `scenario`: multi-room / specified-one-room / load-test
   - `num_rooms`: 教室數量
   - `students_per_room`: 每間教室學生數
   - `lesson_duration`: 課程時長（load-test）
   - `quiz_count`: 測驗次數（load-test）

### GitHub Secrets 設定

到 repo → **Settings** → **Secrets and variables** → **Actions** 新增：

| Secret             | 必填 | 說明                        |
| ------------------ | ---- | --------------------------- |
| `API_URL`          | ✅   | API URL                     |
| `SOCKET_URL`       | ✅   | WebSocket URL               |
| `TEACHER_TOKEN`    | ✅   | 老師 JWT Token              |
| `TEACHER_WS_TOKEN` | ✅   | 老師 WebSocket Token        |
| `ORG_ID`           | ✅   | 組織 ID                     |
| `TEACHER_ID`       | -    | 老師 ID                     |
| `ROOM_ID`          | -    | 教室 ID (specified-one-room)|
| `COLLECTION_ID`    | ✅   | Quiz Collection ID          |
| `K6_INFLUXDB_ADDR` | ✅   | InfluxDB 地址               |

## 關鍵指標

### 核心指標 (Rate)

| 指標                | 說明                 | 目標  |
| ------------------- | -------------------- | ----- |
| `student_connected` | 學生連線成功率       | > 90% |
| `student_seated`    | 學生選座成功率       | > 90% |
| `seat_within_3s`    | 3 秒內選座成功率     | > 95% |
| `answers_submitted` | 答案提交成功率       | > 80% |
| `teacher_connected` | 老師連線成功率       | > 90% |
| `events_received`   | WebSocket 事件接收率 | > 90% |

### 時間指標 (Trend)

| 指標                     | 說明                   | 目標     |
| ------------------------ | ---------------------- | -------- |
| `seat_time`              | 選座 HTTP 請求時間     | < 3000ms |
| `submit_time`            | 提交答案 HTTP 請求時間 | < 3000ms |
| `time_to_seat`           | 總選座時間             | < 3000ms |
| `ws_connect_time`        | WebSocket 連線時間     | < 500ms  |
| `ws_connecting_time`     | WebSocket 建立連線時間 | < 500ms  |
| `quiz_received_time`     | 收到 Quiz 事件時間     | -        |
| `ws_connection_duration` | WebSocket 連線持續時間 | -        |

### HTTP 指標

| 指標                                     | 說明              | 目標     |
| ---------------------------------------- | ----------------- | -------- |
| `http_req_duration{name:choose_seat}`    | 選座請求 95% 時間 | < 3000ms |
| `http_req_duration{name:submit_answers}` | 提交答案 95% 時間 | < 3000ms |
| `http_req_failed`                        | HTTP 請求失敗率   | < 10%    |

### WebSocket 事件計數 (Counter)

| 指標                         | 說明               |
| ---------------------------- | ------------------ |
| `ws_event_quiz_created`      | Quiz 建立事件數    |
| `ws_event_quiz_finished`     | Quiz 結束事件數    |
| `ws_event_quiz_disclosed`    | Quiz 公開事件數    |
| `ws_event_quiz_closed`       | Quiz 關閉事件數    |
| `ws_event_end_lesson`        | 課程結束事件數     |
| `ws_event_student_submitted` | 學生提交答案事件數 |

### WebSocket 連線狀態 (Counter)

連線流程依序為：`ws_connected` → `ws_namespace_connected` → `ws_seat_chosen` → `ws_join_lesson_sent`

| 指標                           | 說明                       |
| ------------------------------ | -------------------------- |
| `ws_connected`                 | WebSocket TCP 握手成功（底層傳輸層）|
| `ws_namespace_connected`       | Socket.IO Namespace 加入成功（應用層，server 回 ack）|
| `ws_seat_chosen`               | 選座 API 成功（拿到 studentId + socketToken） |
| `ws_join_lesson_sent`          | 學生發送 join_lesson 訊息  |
| `ws_teacher_join_lesson_sent`  | 老師發送 join_lesson 訊息  |
| `ws_disconnected`              | WebSocket 正常斷線數       |
| `ws_unexpected_close`          | WebSocket 非預期斷線數     |
| `ws_connection_error`          | WebSocket 連線錯誤數       |

> **`ws_connected` vs `ws_namespace_connected`：** `ws_connected` 是 WebSocket TCP 連線建立，`ws_namespace_connected` 是 Socket.IO 應用層 namespace 握手成功。正常情況數字一致。若 `ws_connected > ws_namespace_connected`，代表有 VU 的 WebSocket 連上了但 Socket.IO namespace 握手失敗（可能是 auth 或 server 拒絕）。

> **斷線處理設計：** 所有 scenario 均**不設重連機制**。壓測的目的是穩定施壓並觀察伺服器反應，斷線本身就是重要信號。自動重連會掩蓋問題（例如連線成功率從 94% 被修飾為 100%）、干擾時序指標、並可能因多人同時重連造成 reconnection storm。斷線時如實記錄 `ws_unexpected_close` 或 `ws_connection_error`，由 Dashboard 呈現即可。
>
> **Error handler 邏輯：** `student_connected` / `teacher_connected` 是 Rate 指標，只在連線從未建立時記錄失敗（`connectionSuccess` flag）。若連線已成功建立後才發生錯誤，不會記錄 `add(0)` 以避免汙染 Rate 分母。

### Event Delivery (Gauge)

用於衡量 API 呼叫 → WS event 投遞到接收方的延遲。每個 metric 記錄發送方和接收方的絕對時間戳（`Date.now()`），Grafana 用 `spread()` 計算 `max - min` 得出 delivery time。

| 指標                          | 方向              | 說明                           |
| ----------------------------- | ----------------- | ------------------------------ |
| `delivery_quiz_created`       | Teacher → Students | 老師出題 → 學生收到事件        |
| `delivery_student_submitted`  | Students → Teacher | 學生提交答案 → 老師收到事件    |
| `delivery_quiz_finished`      | Teacher → Students | 老師結束測驗 → 學生收到事件    |
| `delivery_quiz_disclosed`     | Teacher → Students | 老師公布答案 → 學生收到事件    |
| `delivery_quiz_closed`        | Teacher → Students | 老師關閉測驗 → 學生收到事件    |
| `delivery_lesson_end`         | Teacher → Students | 老師結束課程 → 學生收到事件    |

> **InfluxDB 標籤說明：** 所有 metric `.add()` 呼叫都帶有 `{ room, student }` 或 `{ room, role, student }` 標籤，用來防止 InfluxDB 時間戳碰撞（多個 VU 在同一微秒寫入相同 measurement + tagset 時會被視為同一筆資料覆蓋）。

### HTTP 成功計數 (Counter)

| 指標                          | 說明             |
| ----------------------------- | ---------------- |
| `http_success_create_room`    | 建立教室成功數   |
| `http_success_create_lesson`  | 建立課程成功數   |
| `http_success_choose_seat`    | 選座成功數       |
| `http_success_create_quizzes` | 建立 Quiz 成功數 |
| `http_success_submit_answers` | 提交答案成功數   |
| `http_success_finish_quiz`    | 結束 Quiz 成功數 |
| `http_success_disclose_quiz`  | 公開 Quiz 成功數 |
| `http_success_close_quiz`     | 關閉 Quiz 成功數 |
| `http_success_end_lesson`     | 結束課程成功數   |

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
