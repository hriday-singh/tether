# 09 — Operations

## Environment variables

`.env.example` is kept in sync with `apps/server/src/config.ts` (Zod-validated at boot; the process
refuses to start on invalid config).

| Var | App | Default | Notes |
|-----|-----|---------|-------|
| `PORT` | server | `4000` | REST + WS on the same port |
| `HOST` | server | `0.0.0.0` | Listening host |
| `JWT_SECRET` | server | — | required, ≥ 32 bytes |
| `ALLOWED_ORIGINS` | server | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001` | comma-separated, checked on upgrade + CORS |
| `DATABASE_DRIVER` | server | `sqlite` | `sqlite` (embedded via `node:sqlite`) or `postgres` |
| `SQLITE_PATH` | server | `./data/tether.db` | SQLite database file location (or `:memory:` for tests) |
| `DATABASE_URL` | server | `postgres://postgres:postgres@localhost:5432/tether` | PostgreSQL connection string (when running in Postgres mode) |
| `HOST_GRACE_MS` | server | `5000` | host handover grace |
| `PERSIST_FLUSH_MS` | server | `250` | persistence flush interval |
| `ROOM_UNLOAD_IDLE_MS`| server | `30000` | idle delay before room memory unload |
| `DEMO_MODE` | server | `false` | enables server-side bot storm spawner (`demo.storm`) |
| `NEXT_PUBLIC_SYNC_MODE`| web | `server` | `server` (real Fastify + WS) or `fake` (in-memory) |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` | backend REST API URL |
| `NEXT_PUBLIC_WS_URL` | web | `ws://localhost:4000` | backend WebSocket URL |
| `NEXT_PUBLIC_DEMO_MODE`| web | `false` | enables Network Lab panel and StormPanel |

## Local run (Target flow — Zero external services needed)

```bash
pnpm install
cp .env.example .env                 # fill JWT_SECRET
pnpm build:pkg                        # build @tether/shared and @tether/sync-client
pnpm dev                              # web :3001, server :4000 (SQLite created automatically in data/)
pnpm test                             # all 275+ unit, integration, and chaos tests (60 suites)
pnpm chaos:ci                         # chaos:ci resilience suite
pnpm bench                            # latency benchmark harness
```

### Docker Compose deployment (EC2 / VM)

For one-command deployment to an AWS EC2 instance:
```bash
docker compose up -d                  # runs web + server with mounted SQLite volume
```
*(If testing or running with PostgreSQL, invoke `docker compose --profile postgres up -d` to launch the managed PostgreSQL container alongside).*

## Observability

- **Logs:** pino JSON, one line per connection lifecycle event (`conn.open`, `conn.close{code,reason}`),
  per admission rejection (with reason, never the token), per persistence flush failure. Request IDs on REST.
- **Metrics (`/metrics`):**
  `collab_connections` (gauge), `collab_rooms_loaded` (gauge),
  `collab_frames_in_total{kind}`, `collab_frames_out_total{kind}`,
  `collab_throttle_queued_total`, `collab_outbound_queue_delay_ms` (histogram),
  `collab_apply_duration_ms` (histogram), `collab_persist_flush_ms` (histogram),
  `collab_persist_failures_total`, `collab_close_total{code}`, `collab_admission_rejected_total{reason}`.
- **Health:** `/health/live` (process up), `/health/ready` (DB reachable, persistence buffer below cap, not draining).

## Graceful shutdown

On `SIGTERM`/`SIGINT`:
1. `/health/ready` → 503, upgrade gate rejects with 503.
2. Stop REST intake (Fastify close with in-flight completion).
3. Flush + compact every loaded room (timeout 10 s).
4. Close all sockets with `1012`.
5. Close the DB pool, exit 0. Hard exit after 15 s.

Uncaught exception in a message handler: caught per frame, connection closed `4009`, error logged.
The process never crashes on client input. A true process-level fault → crash + restart (Docker
`restart: unless-stopped`). Clients recover through reconnect + handshake.

## Scale path (documented, not built in v1)

v1: one process owns every room, backed by SQLite (WAL mode). To scale:

1. **Database migration (SQLite → PostgreSQL / AWS RDS):** The repository layer (`apps/server/src/repo/`) strictly abstracts all queries and the schema has a 1:1 PostgreSQL counterpart ([06](06-data-model.md)). Scaling to multi-instance simply points the connection to AWS RDS PostgreSQL using the `pg` driver with zero changes to business logic.
2. **Room affinity, not fan-out.** Route every connection for a room to the same instance (consistent
   hash on `roomId` at the load balancer / a tiny router, or an ownership lease row in PostgreSQL with
   heartbeat). One room = one authoritative Y.Doc = no cross-node merging. Hocuspocus's Redis docs note
   that with Redis fan-out "all messages will be handled on all instances", which is why we prefer affinity.
3. **Move per-IP rate limits and connection caps to Redis** so limits hold across instances.
4. **Ownership handover:** when an instance dies, its lease expires. The next connection for that room lands on
   a new owner, which loads snapshot + tail. Clients reconnect and handshake-resync. The recovery path doesn't change.
5. **AWS shape (week-3 stretch):** ALB (WebSocket, idle timeout > 30 s) → ECS Fargate service → RDS
   PostgreSQL. Secrets in SSM Parameter Store. Web on the same ALB or Amplify/CloudFront.
