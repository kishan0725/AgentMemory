import { VectorStore } from "../vector_store";
import { cosineSimilarity } from "../../memory/embed";

export interface DbOps {
    run_async: (sql: string, params?: any[]) => Promise<void>;
    get_async: (sql: string, params?: any[]) => Promise<any>;
    all_async: (sql: string, params?: any[]) => Promise<any[]>;
}

/**
 * PgVector implementation using PostgreSQL's native vector type and operations.
 */
export class PgVectorStore implements VectorStore {
    private table: string;

    constructor(private db: DbOps, tableName: string = "vectors") {
        this.table = tableName;
    }

    async storeVector(id: string, sector: string, vector: number[], dim: number, user_id?: string, agent_id?: string, session_id?: string): Promise<void> {
        console.error(`[PgVector] Storing ID: ${id}, Sector: ${sector}, Dim: ${dim}`);

        // Convert number array to PostgreSQL vector format
        const vectorStr = `[${vector.join(',')}]`;

        const sql = `insert into ${this.table}(id,sector,user_id,agent_id,session_id,v,dim) values($1,$2,$3,$4,$5,$6::vector,$7) on conflict(id,sector) do update set user_id=excluded.user_id,agent_id=excluded.agent_id,session_id=excluded.session_id,v=excluded.v,dim=excluded.dim`;
        await this.db.run_async(sql, [id, sector, user_id || "anonymous", agent_id || null, session_id || null, vectorStr, dim]);
    }

    async deleteVector(id: string, sector: string): Promise<void> {
        await this.db.run_async(`delete from ${this.table} where id=$1 and sector=$2`, [id, sector]);
    }

    async deleteVectors(id: string): Promise<void> {
        await this.db.run_async(`delete from ${this.table} where id=$1`, [id]);
    }

    async searchSimilar(sector: string, queryVec: number[], topK: number, user_id?: string, agent_id?: string, session_id?: string): Promise<Array<{ id: string; score: number }>> {
        // Convert query vector to PostgreSQL vector format
        const vectorStr = `[${queryVec.join(',')}]`;

        // Build query with optional filtering
        let conditions = [`sector = $2`];
        let params: any[] = [vectorStr, sector];
        let paramIndex = 3;

        if (user_id) {
            conditions.push(`user_id = $${paramIndex}`);
            params.push(user_id);
            paramIndex++;
        }

        if (agent_id) {
            conditions.push(`agent_id = $${paramIndex}`);
            params.push(agent_id);
            paramIndex++;
        }

        if (session_id) {
            conditions.push(`session_id = $${paramIndex}`);
            params.push(session_id);
            paramIndex++;
        }

        const sql = `
            select id, 1 - (v <=> $1::vector) as score
            from ${this.table}
            where ${conditions.join(' and ')}
            order by v <=> $1::vector
            limit $${paramIndex}
        `;
        params.push(topK);

        console.error(`[PgVector] Search Sector: ${sector}, User: ${user_id || 'all'}, Agent: ${agent_id || 'all'}, Session: ${session_id || 'all'}, TopK: ${topK}`);

        const rows = await this.db.all_async(sql, params);

        return rows.map(row => ({
            id: row.id,
            score: row.score
        }));
    }

    async getVector(id: string, sector: string): Promise<{ vector: number[]; dim: number } | null> {
        const row = await this.db.get_async(`select v::text as v_text,dim from ${this.table} where id=$1 and sector=$2`, [id, sector]);
        if (!row) return null;
        
        // Parse vector from PostgreSQL text format: "[1,2,3]"
        const vectorStr = row.v_text.slice(1, -1); // Remove brackets
        const vector = vectorStr.split(',').map((v: string) => parseFloat(v));
        
        return { vector, dim: row.dim };
    }

    async getVectorsById(id: string): Promise<Array<{ sector: string; vector: number[]; dim: number }>> {
        const rows = await this.db.all_async(`select sector,v::text as v_text,dim from ${this.table} where id=$1`, [id]);
        
        return rows.map(row => {
            const vectorStr = row.v_text.slice(1, -1);
            const vector = vectorStr.split(',').map((v: string) => parseFloat(v));
            return { sector: row.sector, vector, dim: row.dim };
        });
    }

    async getVectorsBySector(sector: string): Promise<Array<{ id: string; vector: number[]; dim: number }>> {
        const rows = await this.db.all_async(`select id,v::text as v_text,dim from ${this.table} where sector=$1`, [sector]);
        
        return rows.map(row => {
            const vectorStr = row.v_text.slice(1, -1);
            const vector = vectorStr.split(',').map((v: string) => parseFloat(v));
            return { id: row.id, vector, dim: row.dim };
        });
    }
}
