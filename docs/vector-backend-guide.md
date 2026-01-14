# Vector Backend Selection Guide

> When to use postgres.ts (bytea) vs pgvector.ts (HNSW) for multi-tenant AgentMemory deployments

**Note:** This guide assumes multi-tenant SaaS deployments with multiple users. For single-user applications:
- **< 10K vectors:** postgres.ts is recommended (simple, accurate, <50ms latency)
- **10K-50K vectors:** postgres.ts acceptable (50-200ms latency depending on requirements)
- **> 50K vectors:** Use pgvector.ts even for single user (postgres.ts latency >200ms)

The key factor is total vector count, not user count. A single user with 100K vectors needs pgvector just as much as 100 users with 1K vectors each.

---

## Quick Decision Matrix

| Your Situation | Use | Why |
|----------------|-----|-----|
| **< 500 vectors per user** | postgres.ts | Simple, accurate, fast enough |
| **500-1500 vectors per user** | Either | Both work, pgvector slightly faster |
| **> 1500 vectors per user** | pgvector.ts | postgres.ts too slow (>100ms) |
| **Total < 300K vectors** | postgres.ts | Manageable, true pre-filtering |
| **Total > 400K vectors** | pgvector.ts | Required for scale |
| **Accuracy > Latency** | postgres.ts | Guaranteed k results with pre-filtering |
| **Latency critical** | pgvector.ts | 50-100x faster at scale |
| **SQLite** | postgres.ts | Only option (pgvector Postgres-only) |
| **Can't install extensions** | postgres.ts | No pgvector extension needed |

---

## postgres.ts (Bytea Storage + JS Similarity)

### How It Works
```
1. Filter user's vectors at DB level (WHERE user_id = ?)
2. Transfer to Node.js (e.g., 1000 vectors × 4KB = 4MB)
3. Compute cosine similarity in JavaScript (linear scan)
4. Sort and return top-k
```

### Performance Characteristics

| Vectors Per User | Query Time | Memory Usage |
|-----------------|------------|--------------|
| 100 | 10ms | 400KB |
| 500 | 30ms | 2MB |
| 1,000 | 50ms | 4MB |
| 2,000 | 100ms | 8MB |
| 5,000 | 250ms | 20MB |
| 10,000 | 500ms | 40MB |

### ✅ Advantages
- **True pre-filtering** - searches ONLY user's data
- **Guaranteed results** - always returns k results if available
- **Simple setup** - no Postgres extensions needed
- **Works with SQLite** - same code for both databases
- **Exact results** - no HNSW approximation
- **Predictable latency** - scales linearly with user's data size

### ❌ Disadvantages
- **Slower at scale** - O(n) linear scan
- **Memory overhead** - loads all vectors into Node.js heap
- **Network transfer** - transfers all user vectors
- **CPU intensive** - JavaScript cosine similarity
- **Not scalable** - breaks down at 2K+ vectors per user

### Best For
- Development/testing environments
- **Production with low memory counts** - Up to 1000 vectors per user with <100ms latency requirement
- SQLite deployments
- Small user datasets (<500 vectors each)
- Accuracy-critical applications
- Deployments where pgvector extension unavailable

---

## pgvector.ts (HNSW Index + Native Vector Type)

### How It Works
```
1. HNSW graph traversal in Postgres (examines ~150-300 vectors)
2. Post-filters to user_id (might return < k results)
3. Returns top-k (or whatever matches user_id)
```

### Performance Characteristics

| Vectors Per User | Query Time | Memory Usage |
|-----------------|------------|--------------|
| 100 | 5ms | 1KB |
| 500 | 8ms | 1KB |
| 1,000 | 12ms | 1KB |
| 2,000 | 15ms | 1KB |
| 5,000 | 18ms | 1KB |
| 10,000 | 20ms | 1KB |
| 100,000 | 30ms | 1KB |
| 1,000,000 | 40ms | 1KB |

### ✅ Advantages
- **50-100x faster** - HNSW graph traversal O(log n)
- **Constant memory** - always ~1KB regardless of dataset size
- **Minimal network** - transfers only results
- **Hardware optimized** - SIMD, parallel processing in Postgres
- **Scales infinitely** - handles millions of vectors
- **Battle-tested** - used by major companies

### ❌ Disadvantages
- **Post-filtering** - searches all users, filters after
- **Uncertain result count** - might return < k results
- **Requires pgvector extension** - Postgres only, no SQLite
- **Setup complexity** - extension installation required
- **Approximate results** - HNSW is approximate (99%+ accurate)
- **Over-fetching workaround** - must request k*3 to get k results

### Best For
- Production deployments
- Large user datasets (>1000 vectors per user)
- High-traffic applications
- Latency-sensitive systems
- Multi-tenant SaaS at scale

---

## Configuration

### Use postgres.ts (Default)
```bash
# .env
OM_METADATA_BACKEND=postgres
OM_USE_PGVECTOR=false  # or omit (defaults to false)
OM_EMBEDDINGS=aws  # or openai, ollama, etc.
```

### Use pgvector.ts
```bash
# .env  
OM_METADATA_BACKEND=postgres
OM_USE_PGVECTOR=true
OM_EMBEDDINGS=aws
```

```sql
-- First-time setup
CREATE EXTENSION vector;
```

---

## Migration Path

### Phase 1: Start with postgres.ts
**When:** Initial launch, <300K total vectors

**Configuration:**
```bash
OM_USE_PGVECTOR=false
```

**Benefits:**
- Simple setup
- True pre-filtering
- Accurate results

---

### Phase 2: Migrate to pgvector.ts (with 8 partitions)
**When:** Query latency >80ms, >400K total vectors, or >1500 vectors per user

**Migration Steps:**
1. Create pgvector extension
2. Create new table with vector(1024) type
3. Run migration script (converts bytea → vector)
4. Swap tables
5. Set `OM_USE_PGVECTOR=true`
6. Restart

**Migration Time:** 100K vectors = ~5 minutes

**No re-embedding needed** - just format conversion

---

### Phase 3: Increase Partition Count (8 → 16)
**When:** >2M total vectors, >20K users, or query latency >40ms with 8 partitions

**Migration Required:**
```sql
-- Create 16-partition table
CREATE TABLE vectors_v3 PARTITION BY HASH (user_id) MODULUS 16;
-- Create partitions p0-p15...

-- Copy data (Postgres rehashes to new partitions)
INSERT INTO vectors_v3 SELECT * FROM vectors_v2;

-- Swap tables
ALTER TABLE vectors_v2 RENAME TO vectors_old;
ALTER TABLE vectors_v3 RENAME TO vectors;
```

**Downtime:** ~5-10 minutes for 2M vectors

**Benefit:** Query time: 40ms → 20ms (2x improvement)

---

## Why Partitioning Matters for pgvector

### The pgvector Post-Filtering Problem

**pgvector's HNSW doesn't support pre-filtering** - the WHERE clause is evaluated AFTER neighbor search:

```sql
SELECT id, 1-(v<=>$1) as score FROM vectors
WHERE sector=$2 AND user_id=$3  -- ❌ Applied AFTER HNSW search
ORDER BY v<=>$1 LIMIT 10
```

**What happens:**
1. HNSW searches ALL 5M vectors (all users)
2. Finds top-30 globally nearest neighbors
3. Filters those 30 to user_123
4. Might return 0-30 results (not guaranteed 10)

**Problem:** Wasted 99.9% of search effort on irrelevant users' data

### How Partitioning Helps

**With 16 hash partitions:**

```
Total: 5M vectors across 10K users
Per partition: ~312K vectors (~625 users)

Query for user_123:
1. Hash(user_123) → routes to partition p7
2. HNSW searches only p7's 312K vectors (not all 5M)  
3. Filters to user_123 within p7
4. 16x less wasted work

Result: Search space reduced by 16x (6.25% vs 100%)
```

**Still post-filtering**, but on much smaller dataset.

### Accuracy Impact

**Without partitioning:**
- Request: k=10, fetch k*3=30
- HNSW returns top-30 from 5M vectors
- User's vectors: 0-5 in top-30 (unpredictable)
- Final results: 0-5 (insufficient)

**With 16 partitions:**
- Request: k=10, fetch k*3=30
- HNSW returns top-30 from 312K vectors in user's partition
- User's vectors: 8-15 in top-30 (more likely)
- Final results: 8-15 (better, still not perfect)

**Partitioning improves both performance AND accuracy for pgvector**


## Performance Comparison

### Scenario: 230 users, 500 vectors each = 115K total

| Backend | Query Time | Memory | Accuracy | Complexity |
|---------|------------|--------|----------|------------|
| **postgres.ts** | 30-40ms | 2MB | 100% | Low |
| **pgvector.ts** | 10-15ms | 1KB | 98-99% | Medium |
| **pgvector + 8 partitions** | 8-10ms | 1KB | 98-99% | High |

**For this scale:** postgres.ts is perfectly viable

---

### Scenario: 1000 users, 5000 vectors each = 5M total

| Backend | Query Time | Memory | Accuracy | Complexity |
|---------|------------|--------|----------|------------|
| **postgres.ts** | 250ms ❌ | 20MB ❌ | 100% | Low |
| **pgvector.ts** | 30-40ms ⚠️ | 1KB | 90-95% ⚠️ | Medium |
| **pgvector + 16 partitions** | 15-20ms ✅ | 1KB | 95-98% ✅ | High |

**For this scale:** pgvector + partitioning required

---

## Key Differences

### Result Guarantees

**postgres.ts:**
```
Request: top-10
User has: 500 vectors
Returns: Exactly 10 ✓
```

**pgvector.ts:**
```
Request: top-10 (actually fetches top-30 with k*3 buffer)
User has: 50 vectors in 5M total
HNSW finds: [other_user_A, other_user_B, other_user_C, your_user × 3]
After filter: 3 results (not 10) ⚠️
```

### Pre-filtering vs Post-filtering

**postgres.ts:**
```sql
-- Pre-filters
SELECT id,v FROM vectors WHERE sector=? AND user_id=?
-- Then: JS similarity on filtered set
-- Searches: User's 500 vectors only
```

**pgvector.ts:**
```sql
-- Post-filters
SELECT id, 1-(v<=>$1) as score FROM vectors 
WHERE sector=$2 AND user_id=$3  -- ❌ Evaluated AFTER HNSW
ORDER BY v<=>$1 LIMIT $4
-- Searches: All 5M vectors, then filters
```

---

## Recommendation for Your Scale

**230 users, ~100 memories/user/month:**

### Month 1-2: postgres.ts
- 23K memories = 115K vectors
- Query time: 30-40ms ✅
- True pre-filtering ✅
- Simple ✅

### Month 3-6: Continue postgres.ts
- 70K memories = 350K vectors
- Query time: 50-60ms ⚠️
- Still acceptable for "non-mission-critical"

### Month 6+: Migrate to pgvector.ts
- >100K memories = >500K vectors
- Query time would be 80-120ms with postgres.ts ❌
- Switch to pgvector: 15-20ms ✅

---

## When to Switch

**Monitor query latency:**
```typescript
const start = Date.now();
await mem.search(query, { user_id });
const duration = Date.now() - start;

if (duration > 80) {
    console.warn('Consider switching to pgvector.ts');
}
```

**Switch trigger:**
- Average query time >80ms for 3 days
- OR total vectors >400K
- OR single user >1500 vectors

---

## Summary

**postgres.ts = Simple, accurate, pre-filtering, good for <300K vectors**

**pgvector.ts = Fast, scalable, post-filtering, required for >400K vectors**

**Start simple (postgres.ts), scale when needed (pgvector.ts)**
