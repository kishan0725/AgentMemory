# OpenMemory Improvements

> High-level action items for enhancing OpenMemory's architecture, performance, and reliability

---

## Implementation Checklist

### 🔴 Critical Priority
- [ ] **#1** - Implement table partitioning by user_id for PgVector
- [x] **#2** - Add user_id column to temporal_facts and filter all queries ✅
- [ ] **#3** - Fix HSG cache user isolation and add disable option
- [ ] **#4** - Add limit/offset pagination to temporal fact queries
- [x] **#5** - Create object index on temporal_facts table ✅
- [ ] **#6** - Optimize HSG query with batch DB fetching
- [ ] **#7** - Use pgvector HNSW for waypoint similarity search
- [ ] **#8** - Fix waypoint expansion boundary check

### 🟡 High Priority
- [ ] **#9** - Replace setInterval with cron-based coactivation job queue
- [ ] **#10** - Add batch MCP tools for bulk operations
- [ ] **#11** - Add metadata filtering (tags, dates) to openmemory_query

### 🟠 Medium Priority
- [ ] **#12** - Create openmemory_update_fact tool for confidence/metadata updates
- [ ] **#13** - Enhance error responses with codes, traces, and suggestions
- [ ] **#14** - Standardize date handling to ISO 8601 strings

---

## 🔴 Critical Priority

### 1. PgVector Post-Filtering Performance Issue
**Problem:** PgVector HNSW doesn't support pre-filtering - searches all vectors then filters by user_id post-hoc  
**Impact:** Inefficient multi-tenant queries - searches 100x more vectors than needed, slower as data grows  
**Action:** Implement table partitioning by user_id so HNSW index searches only user's partition  
**Files:** `packages/openmemory-js/src/core/db.ts`, `packages/openmemory-js/src/core/vector/pgvector.ts`  
**Note:** PgVector limitation - WHERE clause filtering happens after HNSW neighbor search completes

### 2. User Level Isolation for Temporal Facts ✅ COMPLETED
**Problem:** Temporal facts are not filtered by user_id, causing data leakage between users  
**Impact:** Security vulnerability - users can see other users' facts in multi-tenant scenarios  
**Action:** Add `user_id` column to `temporal_facts` table and filter all queries by user  
**Files:** `packages/openmemory-js/src/core/db.ts`, `packages/openmemory-js/src/temporal_graph/query.ts`, `packages/openmemory-js/src/ai/mcp.ts`  
**Status:** ✅ Implemented

### 3. HSG Cache User Isolation Bug
**Problem:** Cache key doesn't include user_id, causing cross-user data leakage in multi-tenant deployments  
**Impact:** Security vulnerability - User A can see User B's cached query results  
**Action:** 
  1. Fix cache key generation to always include user_id
  2. Partition cache by user (separate Map per user_id)
  3. Add optional cache disable via `OM_CACHE_ENABLED=false`
**Files:** `packages/openmemory-js/src/memory/hsg.ts` (line ~610, ~643)  
**Note:** Cache is always enabled by default with 60s TTL, no current way to disable

### 4. Temporal Facts Pagination
**Problem:** No limit on temporal fact queries - can return thousands of results causing timeouts  
**Impact:** MCP timeouts, memory exhaustion with large datasets  
**Action:** Add `limit` and `offset` parameters to all temporal query functions  
**Files:** `packages/openmemory-js/src/temporal_graph/query.ts`, `packages/openmemory-js/src/ai/mcp.ts`  

### 5. Missing Object Index ✅ COMPLETED
**Problem:** Queries filtering by fact `object` field perform full table scans  
**Impact:** Severe performance degradation on large fact tables  
**Action:** Add database index: `CREATE INDEX temporal_facts_object_idx ON temporal_facts(object)`  
**Files:** `packages/openmemory-js/src/core/db.ts`  
**Status:** ✅ Implemented

### 6. Excessive Database Calls in HSG Query
**Problem:** Query loop makes 40+ sequential DB calls (4 per result for 10 results)  
**Impact:** High latency on every search operation  
**Action:** Batch fetch all memories and vectors in 2 queries instead of N*4  
**Files:** `packages/openmemory-js/src/memory/hsg.ts` (line ~680)  

### 7. Similarity-Based Waypoint Creation Performance
**Problem:** Linear O(n) scan with in-memory cosine similarity on every insert  
**Impact:** 172ms per insert with 1000 memories; blocks new memory creation  
**Action:** Store mean vectors in pgvector table and use HNSW index for top-1 search  
**Files:** `packages/openmemory-js/src/memory/hsg.ts` (line ~425)  
**Performance gain:** 20-200x faster (172ms → 5-8ms)

### 8. Unbounded Waypoint Expansion Bug
**Problem:** `max_exp` limit can be exceeded by up to max_neighbors per node  
**Impact:** Unpredictable query times, potential timeouts in dense graphs  
**Action:** Check expansion limit before adding each neighbor, not after  
**Files:** `packages/openmemory-js/src/memory/hsg.ts` (line ~500)  

---

## 🟡 High Priority

### 9. Replace setInterval Coactivation with Cron-Based Job Queue
**Problem:** In-memory coactivation buffer with setInterval has multiple issues:
  - Unbounded growth under high load (no size limit)
  - Lost on server restart/deployment
  - No observability or retry logic
  - Blocks application thread every second
  - No backpressure mechanism
**Impact:** 
  - Memory leaks in high-traffic scenarios
  - Query latency (+100ms overhead)
  - Lost coactivation data during deployments
  - No visibility into processing state
**Action:** Replace with database-backed job queue:
  1. Create `coactivation_jobs` table with status tracking
  2. Modify `hsg_query()` to insert job rows (2-5ms overhead)
  3. Implement cron worker to process jobs in batches
  4. Add retry logic and error handling
  5. Support `OM_COACTIVATION_MODE=cron|setInterval|disabled` env var
**Files:** 
  - `packages/openmemory-js/src/memory/hsg.ts` (line ~620, ~740)
  - `packages/openmemory-js/src/core/db.ts` (add schema)
  - `scripts/process-coactivation-jobs.ts` (new worker) 
**Benefits:**
  - ✅ Survives restarts/deployments
  - ✅ Query latency: 82ms (vs 180ms with setInterval)
  - ✅ Full observability via database queries
  - ✅ Scalable (multiple workers)
  - ✅ Explicit retry and error handling
  - ✅ No memory leaks

### 10. Batch Operations Support
**Problem:** All MCP operations are single-item only (store/delete/reinforce one at a time)  
**Impact:** Inefficient bulk imports - 100 memories require 100 sequential MCP calls  
**Action:** Add `openmemory_store_batch`, `openmemory_delete_batch` tools  
**Files:** `packages/openmemory-js/src/ai/mcp.ts`

### 11. No Metadata Filtering
**Problem:** Cannot filter queries by tags, date ranges, or custom metadata fields  
**Impact:** Limited query expressiveness, post-fetch filtering is inefficient  
**Action:** Add `tags`, `startTime`, `endTime`, `metadata` filters to `openmemory_query` tool  
**Files:** `packages/openmemory-js/src/ai/mcp.ts`, `packages/openmemory-js/src/memory/hsg.ts` 

---

## 🟠 Medium Priority

### 12. No Temporal Fact Update Tool
**Problem:** Cannot modify fact confidence, metadata, or manually close facts via MCP  
**Impact:** Temporal facts are immutable once created  
**Action:** Add `openmemory_update_fact` tool with confidence/metadata updates  
**Files:** `packages/openmemory-js/src/ai/mcp.ts`, `packages/openmemory-js/src/temporal_graph/store.ts`  

### 13. Minimal Error Context
**Problem:** Errors return only message string, no codes/traces/suggestions  
**Impact:** Difficult to debug MCP failures  
**Action:** Enhance error responses with error codes, stack traces, actionable suggestions  
**Files:** `packages/openmemory-js/src/ai/mcp_tools.ts` 

### 14. Date Format Inconsistency
**Problem:** Mix of Date objects, timestamps, and ISO strings across codebase  
**Impact:** Potential timezone bugs in point-in-time queries  
**Action:** Standardize on ISO 8601 strings everywhere, document timezone handling  
**Files:** Multiple files across temporal graph and MCP layers  

---

## Key Files Reference

```
MCP Tools:              packages/openmemory-js/src/ai/mcp.ts
Tool Registry:          packages/openmemory-js/src/ai/mcp_tools.ts
Temporal Queries:       packages/openmemory-js/src/temporal_graph/query.ts
Temporal Storage:       packages/openmemory-js/src/temporal_graph/store.ts
HSG Query Logic:        packages/openmemory-js/src/memory/hsg.ts
Coactivation Worker:    scripts/process-coactivation-jobs.ts (to be created)
Database Schema:        packages/openmemory-js/src/core/db.ts
PgVector Store:         packages/openmemory-js/src/core/vector/pgvector.ts
Vector Store Interface: packages/openmemory-js/src/core/vector_store.ts
```

---
