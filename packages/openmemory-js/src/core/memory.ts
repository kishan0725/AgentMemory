
import { add_hsg_memory, hsg_query, update_memory, delete_memory } from "../memory/hsg";
import { q, get_async } from "./db";
import {
    insert_fact,
    batch_insert_facts,
    update_fact,
    invalidate_fact,
    delete_fact
} from "../temporal_graph/store";
import {
    query_facts_at_time,
    get_current_fact,
    query_facts_in_range,
    get_facts_by_subject,
    search_facts
} from "../temporal_graph/query";
import type { TemporalFact } from "../temporal_graph/types";

export interface MemoryOptions {
    user_id?: string;
    tags?: string[];
    [key: string]: any;
}

export interface FactOptions {
    confidence?: number;
    valid_from?: Date;
    metadata?: Record<string, any>;
    user_id?: string;
}

export interface TemporalQueryOptions {
    subject?: string;
    predicate?: string;
    object?: string;
    at?: Date;
    min_confidence?: number;
    user_id?: string;
}

export interface RecallOptions {
    type?: 'contextual' | 'factual' | 'unified';
    fact_pattern?: {
        subject?: string;
        predicate?: string;
        object?: string;
    };
    at?: Date;
    k?: number;
    sector?: string;
    min_salience?: number;
    user_id?: string;
    agent_id?: string;
    session_id?: string;
}

export interface RecallResult {
    contextual?: Array<{
        id: string;
        score: number;
        content: string;
        primary_sector: string;
        sectors: string[];
        salience: number;
        created_at: number;
        updated_at: number;
        last_seen_at: number;
        path: string[];
    }>;
    factual?: Array<TemporalFact>;
}

export interface StoreOptions {
    type?: 'contextual' | 'factual' | 'both';
    facts?: Array<{
        subject: string;
        predicate: string;
        object: string;
        confidence?: number;
        valid_from?: Date;
    }>;
    tags?: string[];
    metadata?: Record<string, any>;
    user_id?: string;
    agent_id?: string;
    session_id?: string;
}

export interface StoreResult {
    hsg?: {
        id: string;
        primary_sector: string;
        sectors: string[];
    };
    temporal?: Array<{
        id: string;
        subject: string;
        predicate: string;
        object: string;
    }>;
}

export interface UpdateOptions {
    type?: 'contextual' | 'factual';
    scope?: 'global' | 'workspace';
    // For contextual (HSG) updates
    content?: string;
    tags?: string[];
    metadata?: Record<string, any>;
    // For factual (temporal) updates - creates new version by invalidating old and creating new
    subject?: string;
    predicate?: string;
    object?: string;
    confidence?: number;
    valid_from?: Date;
    // Identifiers
    user_id?: string;
    workspace_id?: string;
    agent_id?: string;
    session_id?: string;
}

export interface DeleteOptions {
    type?: 'contextual' | 'factual';
    scope?: 'global' | 'workspace';
    // For factual deletion behavior (always soft delete via invalidation)
    valid_to?: Date;  // When to invalidate temporal facts (default: now)
    // Identifiers
    user_id?: string;
    workspace_id?: string;
}

export interface UpdateResult {
    id: string;
    updated: boolean;
    type: 'contextual' | 'factual';
}

export interface DeleteResult {
    id: string;
    deleted: boolean;
    type: 'contextual' | 'factual';
    soft_deleted?: boolean;
}

export class Memory {
    default_user: string | null;

    constructor(user_id?: string) {
        this.default_user = user_id || null;
    }

    async add(content: string, opts?: MemoryOptions) {
        const uid = opts?.user_id || this.default_user;
        const tags = opts?.tags || [];
        const agent_id = opts?.agent_id;
        const session_id = opts?.session_id;
        const meta = { ...opts };
        delete meta.user_id;
        delete meta.tags;
        delete meta.agent_id;
        delete meta.session_id;

        const tags_str = JSON.stringify(tags);

        const res = await add_hsg_memory(content, tags_str, meta, uid ?? undefined, agent_id, session_id);
        return res;
    }

    async get(id: string, opts?: { include_vectors?: boolean }) {
        const mem = await q.get_mem.get(id);
        if (!mem) return null;

        if (opts?.include_vectors) {
            const { vector_store } = await import("./db");
            const vectors = await vector_store.getVectorsById(id);
            return { ...mem, vectors };
        }

        return mem;
    }

    async list(opts?: { user_id?: string, limit?: number, offset?: number, sector?: string, agent_id?: string, session_id?: string }) {
        const limit = opts?.limit || 10;
        const offset = opts?.offset || 0;
        const uid = opts?.user_id || this.default_user;
        const sector = opts?.sector;
        const agent_id = opts?.agent_id;
        const session_id = opts?.session_id;

        let rows: any[];
        if (uid) {
            const all = await q.all_mem_by_user.all(uid, limit, offset);
            rows = sector ? all.filter((row: any) => row.primary_sector === sector) : all;
        } else {
            rows = sector
                ? await q.all_mem_by_sector.all(sector, limit, offset)
                : await q.all_mem.all(limit, offset);
        }

        // Filter by agent_id and session_id at application level
        if (agent_id) {
            rows = rows.filter((row: any) => row.agent_id === agent_id);
        }
        if (session_id) {
            rows = rows.filter((row: any) => row.session_id === session_id);
        }

        return rows;
    }

    async search(query: string, opts?: { user_id?: string, limit?: number, sectors?: string[], agent_id?: string, session_id?: string }) {
        const k = opts?.limit || 10;
        const uid = opts?.user_id || this.default_user;
        const f: any = {};
        if (uid) f.user_id = uid;
        if (opts?.sectors) f.sectors = opts.sectors;
        if (opts?.agent_id) f.agent_id = opts.agent_id;
        if (opts?.session_id) f.session_id = opts.session_id;

        return await hsg_query(query, k, f);
    }

    async wipe() {
        console.log("[Memory] Wiping DB...");

        await q.clear_all.run();
    }

    /**
     * get a pre-configured source connector.
     *
     * usage:
     *   const github = mem.source("github")
     *   await github.connect({ token: "ghp_..." })
     *   await github.ingest_all({ repo: "owner/repo" })
     *
     * available sources: github, notion, google_drive, google_sheets,
     *                   google_slides, onedrive, web_crawler
     */
    source(name: string) {

        const sources: Record<string, any> = {
            github: () => import("../sources/github").then(m => new m.github_source(this.default_user ?? undefined)),
            notion: () => import("../sources/notion").then(m => new m.notion_source(this.default_user ?? undefined)),
            google_drive: () => import("../sources/google_drive").then(m => new m.google_drive_source(this.default_user ?? undefined)),
            google_sheets: () => import("../sources/google_sheets").then(m => new m.google_sheets_source(this.default_user ?? undefined)),
            google_slides: () => import("../sources/google_slides").then(m => new m.google_slides_source(this.default_user ?? undefined)),
            onedrive: () => import("../sources/onedrive").then(m => new m.onedrive_source(this.default_user ?? undefined)),
            web_crawler: () => import("../sources/web_crawler").then(m => new m.web_crawler_source(this.default_user ?? undefined)),
        };

        if (!(name in sources)) {
            throw new Error(`unknown source: ${name}. available: ${Object.keys(sources).join(", ")}`);
        }

        return sources[name]();
    }

    // ============================================
    // Temporal Fact Methods
    // ============================================

    /**
     * Store a single temporal fact in the temporal graph.
     *
     * A fact represents a statement that is true for a specific period of time.
     * Example: addFact("John", "works_at", "Acme Corp", { valid_from: new Date("2023-01-01") })
     *
     * @param subject - The entity (e.g., "John", "user_123")
     * @param predicate - The relationship or property (e.g., "works_at", "lives_in", "age")
     * @param object - The value or target entity (e.g., "Acme Corp", "New York", "30")
     * @param opts - Optional settings including confidence (0-1), valid_from date, and metadata
     * @returns The ID of the created fact
     */
    async addFact(
        subject: string,
        predicate: string,
        object: string,
        opts?: FactOptions
    ): Promise<string> {
        const valid_from = opts?.valid_from || new Date();
        const confidence = opts?.confidence ?? 1.0;
        const metadata = opts?.metadata;
        const uid = opts?.user_id || this.default_user;

        return await insert_fact(
            subject,
            predicate,
            object,
            valid_from,
            confidence,
            metadata,
            uid ?? undefined
        );
    }

    /**
     * Store multiple temporal facts at once in a transaction.
     *
     * Useful for batch operations. All facts are inserted atomically.
     *
     * @param facts - Array of facts to insert
     * @returns Array of created fact IDs
     */
    async addFacts(facts: Array<{
        subject: string;
        predicate: string;
        object: string;
        confidence?: number;
        valid_from?: Date;
        metadata?: Record<string, any>;
        user_id?: string;
    }>, user_id?: string): Promise<string[]> {
        const uid = user_id || this.default_user;
        const factsWithUser = facts.map(f => ({
            ...f,
            user_id: f.user_id || (uid ?? undefined)
        }));
        return await batch_insert_facts(factsWithUser);
    }

    /**
     * Query temporal facts with flexible filtering.
     *
     * Supports wildcard queries by omitting parameters.
     * Examples:
     *   - queryFacts({ subject: "John" }) - all facts about John
     *   - queryFacts({ predicate: "works_at" }) - all employment facts
     *   - queryFacts({ subject: "John", predicate: "works_at", at: pastDate }) - where John worked at a specific time
     *
     * @param opts - Query options including subject, predicate, object, time point, and confidence threshold
     * @returns Array of matching temporal facts
     */
    async queryFacts(opts?: TemporalQueryOptions): Promise<TemporalFact[]> {
        const at = opts?.at || new Date();
        const min_confidence = opts?.min_confidence ?? 0.0;
        const uid = opts?.user_id || this.default_user;

        return await query_facts_at_time(
            opts?.subject,
            opts?.predicate,
            opts?.object,
            at,
            min_confidence,
            uid ?? undefined
        );
    }

    /**
     * Get the current value of a specific fact.
     *
     * Returns the most recent active fact for the given subject-predicate pair.
     * Example: getCurrentFact("John", "works_at") returns current employer
     *
     * @param subject - The entity
     * @param predicate - The property/relationship
     * @returns The current fact or null if none exists
     */
    async getCurrentFact(
        subject: string,
        predicate: string,
        user_id?: string
    ): Promise<TemporalFact | null> {
        const uid = user_id || this.default_user;
        return await get_current_fact(subject, predicate, uid ?? undefined);
    }

    /**
     * Get all facts about a specific subject (entity).
     *
     * Useful for building a complete profile of an entity.
     *
     * @param subject - The entity to query
     * @param opts - Options including time point and whether to include historical facts
     * @returns Array of facts about the subject
     */
    async getFactsBySubject(
        subject: string,
        opts?: {
            at?: Date;
            include_historical?: boolean;
            user_id?: string;
        }
    ): Promise<TemporalFact[]> {
        const uid = opts?.user_id || this.default_user;
        return await get_facts_by_subject(
            subject,
            opts?.at,
            opts?.include_historical || false,
            uid ?? undefined
        );
    }

    /**
     * Query facts within a time range.
     *
     * Useful for timeline queries and historical analysis.
     *
     * @param opts - Options including subject, predicate, time range (from/to), and confidence threshold
     * @returns Array of facts valid during the specified time range
     */
    async queryFactsInRange(opts: {
        subject?: string;
        predicate?: string;
        from?: Date;
        to?: Date;
        min_confidence?: number;
        user_id?: string;
    }): Promise<TemporalFact[]> {
        const uid = opts.user_id || this.default_user;
        return await query_facts_in_range(
            opts.subject,
            opts.predicate,
            opts.from,
            opts.to,
            opts.min_confidence ?? 0.0,
            uid ?? undefined
        );
    }

    /**
     * Search for facts using a text pattern.
     *
     * Searches within subject, predicate, or object fields using SQL LIKE pattern matching.
     *
     * @param pattern - Search text (e.g., "John", "Acme")
     * @param field - Which field to search in: 'subject', 'predicate', or 'object'
     * @param at - Optional time point for the query (default: now)
     * @returns Array of matching facts (max 100)
     */
    async searchFacts(
        pattern: string,
        field: 'subject' | 'predicate' | 'object' = 'subject',
        at?: Date,
        user_id?: string
    ): Promise<TemporalFact[]> {
        const uid = user_id || this.default_user;
        return await search_facts(pattern, field, at, uid ?? undefined);
    }

    /**
     * Update an existing fact's confidence or metadata.
     *
     * Note: Cannot update subject/predicate/object. Create a new fact instead.
     *
     * @param id - The fact ID
     * @param opts - Fields to update (confidence and/or metadata)
     */
    async updateFact(
        id: string,
        opts: {
            confidence?: number;
            metadata?: Record<string, any>;
            user_id?: string;
        }
    ): Promise<void> {
        const uid = opts.user_id || this.default_user;

        // Validate ownership if user_id is specified
        if (uid) {
            const fact = await get_async(
                'SELECT user_id FROM temporal_facts WHERE id = ?',
                [id]
            ) as any;

            if (!fact) {
                throw new Error(`Fact ${id} not found`);
            }

            if (fact.user_id !== uid) {
                throw new Error(`Fact ${id} not found for user ${uid}`);
            }
        }

        return await update_fact(id, opts.confidence, opts.metadata);
    }

    /**
     * Invalidate a fact by setting its valid_to date.
     *
     * This marks the fact as no longer valid after the specified date.
     * The fact remains in the database for historical queries.
     *
     * @param id - The fact ID
     * @param valid_to - When the fact becomes invalid (default: now)
     */
    async invalidateFact(
        id: string,
        valid_to?: Date,
        user_id?: string
    ): Promise<void> {
        const uid = user_id || this.default_user;

        // Validate ownership if user_id is specified
        if (uid) {
            const fact = await get_async(
                'SELECT user_id FROM temporal_facts WHERE id = ?',
                [id]
            ) as any;

            if (!fact) {
                throw new Error(`Fact ${id} not found`);
            }

            if (fact.user_id !== uid) {
                throw new Error(`Fact ${id} not found for user ${uid}`);
            }
        }

        return await invalidate_fact(id, valid_to);
    }

    /**
     * Permanently delete a fact from the temporal graph.
     *
     * Warning: This is irreversible. Consider using invalidateFact() instead.
     *
     * @param id - The fact ID to delete
     */
    async deleteFact(id: string, user_id?: string): Promise<void> {
        const uid = user_id || this.default_user;

        // Validate ownership if user_id is specified
        if (uid) {
            const fact = await get_async(
                'SELECT user_id FROM temporal_facts WHERE id = ?',
                [id]
            ) as any;

            if (!fact) {
                throw new Error(`Fact ${id} not found`);
            }

            if (fact.user_id !== uid) {
                throw new Error(`Fact ${id} not found for user ${uid}`);
            }
        }

        return await delete_fact(id);
    }

    // ============================================
    // Unified Query Methods (HSG + Temporal)
    // ============================================

    /**
     * Recall memories from HSG (contextual memory) and/or temporal graph (facts).
     *
     * This is the primary unified query method with a clean, intuitive API.
     * It pairs semantically with store() for a consistent read/write interface.
     *
     * Query types:
     *   - 'unified': Search both HSG and temporal facts (default)
     *   - 'contextual': Search only HSG semantic memory
     *   - 'factual': Search only temporal facts
     *
     * Examples:
     *   recall("What did John work on last year?", { type: 'unified', at: pastDate })
     *   recall("Find employment facts", { type: 'factual', fact_pattern: { predicate: 'works_at' } })
     *   recall("Recent project work", { type: 'contextual', sector: 'episodic' })
     *
     * @param query - Free-form search text
     * @param opts - Query options for filtering and routing
     * @returns Results from HSG and/or temporal graph
     */
    async recall(query: string, opts?: RecallOptions): Promise<RecallResult> {
        const type = opts?.type || 'unified';
        const at = opts?.at || new Date();
        const k = opts?.k || 8;
        const user_id = opts?.user_id || this.default_user;
        const results: any = {};

        // Query HSG if contextual or unified
        if (type === 'contextual' || type === 'unified') {
            const filters: any = {};
            if (opts?.sector) filters.sectors = [opts.sector];
            if (opts?.min_salience !== undefined) filters.minSalience = opts.min_salience;
            if (user_id) filters.user_id = user_id;
            if (opts?.agent_id) filters.agent_id = opts.agent_id;
            if (opts?.session_id) filters.session_id = opts.session_id;

            const matches = await hsg_query(query, k, filters);
            results.contextual = matches.map((m: any) => ({
                id: m.id,
                score: m.score,
                content: m.content,
                primary_sector: m.primary_sector,
                sectors: m.sectors,
                salience: m.salience,
                created_at: m.created_at,
                updated_at: m.updated_at,
                last_seen_at: m.last_seen_at,
                path: m.path,
            }));
        }

        // Query temporal facts if factual or unified
        if (type === 'factual' || type === 'unified') {
            const facts = await query_facts_at_time(
                opts?.fact_pattern?.subject,
                opts?.fact_pattern?.predicate,
                opts?.fact_pattern?.object,
                at,
                0.0,
                user_id ?? undefined,
                opts?.agent_id,
                opts?.session_id
            );
            results.factual = facts;
        }

        return results;
    }

    /**
     * Store content into OpenMemory's HSG (contextual) and/or temporal graph (facts).
     *
     * This is the primary unified write method with a clean, intuitive API.
     * It pairs semantically with recall() for a consistent read/write interface.
     *
     * Storage types:
     *   - 'contextual': Store only in HSG semantic memory (default)
     *   - 'factual': Store only in temporal graph as structured facts
     *   - 'both': Store in both HSG and temporal graph with bidirectional linking
     *
     * Examples:
     *   // Store contextual memory only
     *   store("John loves TypeScript", { tags: ["preferences"] })
     *
     *   // Store temporal facts only
     *   store("", {
     *     type: 'factual',
     *     facts: [{ subject: "John", predicate: "works_at", object: "Acme Corp" }]
     *   })
     *
     *   // Store in both systems with linking
     *   store("John started at Acme Corp as SWE on Jan 1, 2023", {
     *     type: 'both',
     *     facts: [
     *       { subject: "John", predicate: "works_at", object: "Acme Corp" },
     *       { subject: "John", predicate: "role", object: "Software Engineer" }
     *     ],
     *     tags: ["employment"]
     *   })
     *
     * @param content - Natural language text to store (required for 'contextual' and 'both')
     * @param opts - Storage options including type, facts, tags, metadata, and user_id
     * @returns IDs and metadata for stored memories and/or facts
     */
    async store(content: string, opts?: StoreOptions): Promise<StoreResult> {
        const type = opts?.type || 'contextual';
        const uid = opts?.user_id || this.default_user;
        const result: StoreResult = {};

        // Validate requirements
        if (type === 'factual' && (!opts?.facts || opts.facts.length === 0)) {
            throw new Error("Facts array is required when type is 'factual'");
        }
        if ((type === 'contextual' || type === 'both') && !content) {
            throw new Error(`Content is required when type is '${type}'`);
        }

        // Store in HSG if contextual or both
        if (type === 'contextual' || type === 'both') {
            const tags = opts?.tags || [];
            const meta = { ...opts?.metadata };

            const hsg_result = await add_hsg_memory(
                content,
                JSON.stringify(tags),
                meta,
                uid ?? undefined,
                opts?.agent_id,
                opts?.session_id
            );

            result.hsg = {
                id: hsg_result.id,
                primary_sector: hsg_result.primary_sector,
                sectors: hsg_result.sectors,
            };
        }

        // Store in temporal graph if factual or both
        if ((type === 'factual' || type === 'both') && opts?.facts) {
            const meta = { ...opts?.metadata };

            // Link to HSG memory if storing both
            if (type === 'both' && result.hsg?.id) {
                meta.source_memory_id = result.hsg.id;
            }

            const factsToInsert = opts.facts.map(f => ({
                subject: f.subject,
                predicate: f.predicate,
                object: f.object,
                valid_from: f.valid_from || new Date(),
                confidence: f.confidence ?? 1.0,
                metadata: meta,
                user_id: uid ?? undefined,
                agent_id: opts?.agent_id,
                session_id: opts?.session_id
            }));

            const fact_ids = await batch_insert_facts(factsToInsert);

            result.temporal = opts.facts.map((fact, index) => ({
                id: fact_ids[index],
                subject: fact.subject,
                predicate: fact.predicate,
                object: fact.object,
            }));
        }

        return result;
    }

    /**
     * Update memory - contextual (in-place) or factual (versioned).
     *
     * Contextual: Updates content/tags/metadata in place
     * Factual: Invalidates old fact and creates new version
     *
     * @param id - Memory or fact ID
     * @param opts - Update options (type, scope, fields)
     * @returns Update result with new ID for factual updates
     */
    async update(id: string, opts?: UpdateOptions): Promise<UpdateResult> {
        const type = opts?.type || 'contextual';
        const scope = opts?.scope || 'global';

        // Determine the identifier based on scope
        const identifier = scope === 'workspace' ? opts?.workspace_id : (opts?.user_id || this.default_user);

        if (type === 'contextual') {
            // Update HSG memory
            const result = await update_memory(
                id,
                opts?.content,
                opts?.tags,
                opts?.metadata,
                identifier ?? undefined
            );
            return {
                id: result.id,
                updated: result.updated,
                type: 'contextual'
            };
        } else if (type === 'factual') {
            // Temporal fact update: Invalidate old + create new (proper versioning)

            // First, get the existing fact to retrieve its data
            const existingFact = await get_async(
                'SELECT * FROM temporal_facts WHERE id = ?',
                [id]
            ) as any;

            if (!existingFact) {
                throw new Error(`Fact ${id} not found`);
            }

            // Validate ownership
            if (identifier && existingFact.user_id && existingFact.user_id !== identifier) {
                throw new Error(`Fact ${id} not found for user ${identifier}`);
            }

            const now = new Date();

            // Step 1: Invalidate the old fact
            await this.invalidateFact(id, now, identifier ?? undefined);

            // Step 2: Create new fact with updated values (or keep old values if not provided)
            const newFactId = await this.addFact(
                opts?.subject || existingFact.subject,
                opts?.predicate || existingFact.predicate,
                opts?.object || existingFact.object,
                {
                    valid_from: opts?.valid_from || now,
                    confidence: opts?.confidence ?? existingFact.confidence,
                    metadata: opts?.metadata ? {
                        ...JSON.parse(existingFact.metadata || '{}'),
                        ...opts.metadata,
                        _previous_fact_id: id,
                        _superseded_at: now.toISOString()
                    } : JSON.parse(existingFact.metadata || '{}'),
                    user_id: identifier ?? undefined
                }
            );

            return {
                id: newFactId,
                updated: true,
                type: 'factual'
            };
        } else {
            throw new Error(`Invalid update type: ${type}. Must be 'contextual' or 'factual'`);
        }
    }

    /**
     * Delete memory - contextual (permanent) or factual (invalidated).
     *
     * Contextual: Permanently removed from database
     * Factual: Invalidated (soft delete) to preserve temporal history
     *
     * @param id - Memory or fact ID
     * @param opts - Delete options (type, scope)
     * @returns Delete result with soft_deleted flag
     */
    async delete(id: string, opts?: DeleteOptions): Promise<DeleteResult> {
        const type = opts?.type || 'contextual';
        const scope = opts?.scope || 'global';

        // Determine the identifier based on scope
        const identifier = scope === 'workspace' ? opts?.workspace_id : (opts?.user_id || this.default_user);

        if (type === 'contextual') {
            // Delete HSG memory (always hard delete)
            const success = await delete_memory(id, identifier ?? undefined);
            return {
                id,
                deleted: success,
                type: 'contextual'
            };
        } else if (type === 'factual') {
            // Temporal facts always use soft delete (invalidation) to preserve history
            await this.invalidateFact(id, opts?.valid_to || new Date(), identifier ?? undefined);
            return {
                id,
                deleted: true,
                type: 'factual',
                soft_deleted: true
            };
        } else {
            throw new Error(`Invalid delete type: ${type}. Must be 'contextual' or 'factual'`);
        }
    }
}
