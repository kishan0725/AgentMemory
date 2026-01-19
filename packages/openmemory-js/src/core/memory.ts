
import { add_hsg_memory, hsg_query } from "../memory/hsg";
import { q, get_async } from "./db";
import { j } from "../utils";
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

export interface UnifiedQueryOptions {
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
}

export class Memory {
    default_user: string | null;

    constructor(user_id?: string) {
        this.default_user = user_id || null;
    }

    async add(content: string, opts?: MemoryOptions) {
        const uid = opts?.user_id || this.default_user;
        const tags = opts?.tags || [];
        const meta = { ...opts };
        delete meta.user_id;
        delete meta.tags;






        const tags_str = JSON.stringify(tags);



        const res = await add_hsg_memory(content, tags_str, meta, uid ?? undefined);
        return res;
    }

    async get(id: string) {
        return await q.get_mem.get(id);
    }

    async search(query: string, opts?: { user_id?: string, limit?: number, sectors?: string[] }) {

        const k = opts?.limit || 10;
        const uid = opts?.user_id || this.default_user;
        const f: any = {};
        if (uid) f.user_id = uid;
        if (opts?.sectors) f.sectors = opts.sectors;

        return await hsg_query(query, k, f);
    }

    async delete_all(user_id?: string) {
        const uid = user_id || this.default_user;
        if (uid) {



        }
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
     * Unified query across both HSG (contextual memory) and temporal graph (facts).
     *
     * This is the most powerful query method, allowing you to search both systems simultaneously.
     *
     * Query types:
     *   - 'contextual': Search only HSG semantic memory (default)
     *   - 'factual': Search only temporal facts
     *   - 'unified': Search both systems and get combined results
     *
     * Examples:
     *   queryUnified("What did John work on last year?", { type: 'unified', at: pastDate })
     *   queryUnified("Find all employment facts", { type: 'factual', fact_pattern: { predicate: 'works_at' } })
     *
     * @param query - Free-form search text
     * @param opts - Query options for filtering and routing
     * @returns Results from HSG and/or temporal graph
     */
    async queryUnified(
        query: string,
        opts?: UnifiedQueryOptions
    ): Promise<{
        contextual?: Array<{
            id: string;
            score: number;
            content: string;
            primary_sector: string;
            sectors: string[];
            salience: number;
            last_seen_at: number;
            path: string[];
        }>;
        factual?: Array<TemporalFact>;
    }> {
        const type = opts?.type || 'contextual';
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

            const matches = await hsg_query(query, k, filters);
            results.contextual = matches.map((m: any) => ({
                id: m.id,
                score: m.score,
                content: m.content,
                primary_sector: m.primary_sector,
                sectors: m.sectors,
                salience: m.salience,
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
                user_id ?? undefined
            );
            results.factual = facts;
        }

        return results;
    }

    /**
     * Store content in both HSG (contextual memory) and temporal graph (facts) simultaneously.
     *
     * This creates rich, interconnected memory by storing both:
     * 1. Semantic/contextual representation in HSG for similarity search
     * 2. Structured facts in temporal graph for precise querying
     *
     * Example:
     *   addMemoryWithFacts(
     *     "John started working at Acme Corp as a Software Engineer on Jan 1, 2023",
     *     [
     *       { subject: "John", predicate: "works_at", object: "Acme Corp" },
     *       { subject: "John", predicate: "role", object: "Software Engineer" }
     *     ],
     *     { tags: ["employment"], user_id: "user_123" }
     *   )
     *
     * @param content - Natural language text to store in HSG
     * @param facts - Structured facts to extract and store in temporal graph
     * @param opts - Optional tags, metadata, and user_id
     * @returns IDs and metadata for both storage systems
     */
    async addMemoryWithFacts(
        content: string,
        facts: Array<{
            subject: string;
            predicate: string;
            object: string;
            confidence?: number;
            valid_from?: Date;
        }>,
        opts?: MemoryOptions
    ): Promise<{
        hsg: {
            id: string;
            primary_sector: string;
            sectors: string[];
        };
        temporal: Array<{
            id: string;
            subject: string;
            predicate: string;
            object: string;
        }>;
    }> {
        const uid = opts?.user_id || this.default_user;
        const tags = opts?.tags || [];
        const meta = { ...opts };
        delete meta.user_id;
        delete meta.tags;

        // Store in HSG
        const hsg_result = await add_hsg_memory(
            content,
            JSON.stringify(tags),
            meta,
            uid ?? undefined
        );

        // Store facts in temporal graph with link to HSG memory
        const temporal_results = [];
        for (const fact of facts) {
            const valid_from = fact.valid_from || new Date();
            const confidence = fact.confidence ?? 1.0;

            // Link temporal fact to HSG memory by storing memory ID in metadata
            const fact_metadata = {
                ...meta,
                source_memory_id: hsg_result.id
            };

            const fact_id = await insert_fact(
                fact.subject,
                fact.predicate,
                fact.object,
                valid_from,
                confidence,
                fact_metadata,
                uid ?? undefined
            );

            temporal_results.push({
                id: fact_id,
                subject: fact.subject,
                predicate: fact.predicate,
                object: fact.object,
            });
        }

        return {
            hsg: {
                id: hsg_result.id,
                primary_sector: hsg_result.primary_sector,
                sectors: hsg_result.sectors,
            },
            temporal: temporal_results,
        };
    }
}
