# Async processing and capacity

## Runtime model

User-facing API routes reserve credits and insert a `queued` database row before
returning. Provider polling, media downloads, ffmpeg, stitching, and uploads run
outside the HTTP request in the job processor.

Every worker process intentionally handles **one heavy render at a time**.
Running several ffmpeg pipelines inside one Node process previously exhausted
memory and caused retry loops. Parallel capacity therefore comes from independent
worker processes:

```text
total concurrent renders =
  sum(WORKER_PROCESS_COUNT across all dedicated worker deployments)
  + embedded API processors that are explicitly enabled
```

The database claim uses `FOR UPDATE ... SKIP LOCKED`, and provider calls are
guarded by the persisted claim timestamp. Multiple processes can drain the same
queue without claiming the same job or letting an old owner overwrite a new one.
Jobs from the same user remain serialized intentionally so the furthest-along job
finishes before another job spends that user's credits.

## Recommended production topology

1. Run the web frontends as static deployments.
2. Run the API as an HTTP deployment.
3. Run `@workspace/worker` on a **Reserved VM** so polling and heartbeats never
   scale to zero.
4. Set `RUN_JOB_PROCESSOR=false` on the API after the dedicated worker is live.
   Leave it enabled only when the API is intentionally acting as the worker.
5. Start with `WORKER_PROCESS_COUNT=1`. Increase to `2` only after the worker VM
   has enough memory for two simultaneous peak ffmpeg pipelines. Increase one
   step at a time while watching queue age, memory, and restarts.

Do not run a long-lived background worker only on an Autoscale deployment:
Autoscale instances can scale to zero when HTTP traffic is idle.

## Capacity and timeout settings

| Variable | Default | Purpose |
| --- | ---: | --- |
| `WORKER_PROCESS_COUNT` | `1` | Independent worker child processes supervised by the worker service. Valid range is 1–8. |
| `WORKER_ID` | host + PID | Stable prefix used to identify worker processes in logs and health responses. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | `30000` | Time allowed for an active job to drain before process shutdown. Maximum 5 minutes. |
| `WORKER_METRICS_INTERVAL_MS` | `60000` | Queue/capacity log interval while work exists. Valid range is 30 seconds–10 minutes. |
| `DB_POOL_MAX` | `10` | PostgreSQL connections per Node process. Valid range is 1–100. |
| `DB_IDLE_TIMEOUT_MS` | `30000` | Idle database connection lifetime. |
| `DB_CONNECTION_TIMEOUT_MS` | `10000` | Maximum wait when opening a database connection. |
| `DB_POOL_MAX_USES` | unlimited | Optional connection recycle count. |
| `API_REQUEST_TIMEOUT_MS` | `120000` | Maximum API request lifetime. |
| `API_HEADERS_TIMEOUT_MS` | `30000` | Maximum time to receive HTTP headers. |
| `API_KEEP_ALIVE_TIMEOUT_MS` | `5000` | Idle keep-alive socket timeout. |
| `API_MAX_REQUESTS_PER_SOCKET` | `1000` | Connection recycling under sustained traffic. |

Database pool sizing is **per process**. For example, a supervisor with four
worker children and `DB_POOL_MAX=10` may open up to 40 database connections.
Lower the per-process pool before increasing process count if the database
connection budget is limited.

## Health and readiness

- API liveness: `GET /api/healthz`
- API readiness and queue pressure: `GET /api/readyz`
- Worker supervisor liveness: `GET /worker/health`
- Worker supervisor readiness and queue pressure: `GET /worker/ready`

Readiness reports:

- configured and ready worker process counts
- total process capacity
- queued and active job counts
- oldest queued job and queue age
- database availability

The worker supervisor restarts a failed child with exponential backoff. During
shutdown it stops accepting work, asks every child to drain, and only then closes
the database pool. A claim acquired concurrently with shutdown is returned to
the queue before any provider call begins.

## Capacity signals

Add worker capacity when the oldest queued-job age grows continuously while all
configured processes remain ready. Increasing API instances will not reduce a
render backlog; increase worker processes or worker deployments instead.

Reduce `WORKER_PROCESS_COUNT` or increase VM memory if the supervisor repeatedly
restarts children, the host swaps heavily, or ffmpeg exits from memory pressure.
Do not remove the one-job-per-process guard.