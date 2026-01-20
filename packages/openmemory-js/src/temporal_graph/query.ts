

import { get_async, all_async } from '../core/db'
import { TemporalFact, TemporalQuery, TimelineEntry } from './types'


export const query_facts_at_time = async (
    subject?: string,
    predicate?: string,
    object?: string,
    at: Date = new Date(),
    min_confidence: number = 0.1,
    user_id?: string
): Promise<TemporalFact[]> => {
    const timestamp = at.getTime()
    const conditions: string[] = []
    const params: any[] = []


    conditions.push('(valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?))')
    params.push(timestamp, timestamp)

    if (user_id) {
        conditions.push('user_id = ?')
        params.push(user_id)
    }

    if (subject) {
        conditions.push('subject = ?')
        params.push(subject)
    }

    if (predicate) {
        conditions.push('predicate = ?')
        params.push(predicate)
    }

    if (object) {
        conditions.push('object = ?')
        params.push(object)
    }

    if (min_confidence > 0) {
        conditions.push('confidence >= ?')
        params.push(min_confidence)
    }

    const sql = `
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
        FROM temporal_facts
        WHERE ${conditions.join(' AND ')}
        ORDER BY confidence DESC, valid_from DESC
    `

    const rows = await all_async(sql, params)
    return rows.map(row => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }))
}


export const get_current_fact = async (
    subject: string,
    predicate: string,
    user_id?: string
): Promise<TemporalFact | null> => {
    const conditions = ['subject = ?', 'predicate = ?', 'valid_to IS NULL']
    const params: any[] = [subject, predicate]

    if (user_id) {
        conditions.push('user_id = ?')
        params.push(user_id)
    }

    const row = await get_async(`
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
        FROM temporal_facts
        WHERE ${conditions.join(' AND ')}
        ORDER BY valid_from DESC
        LIMIT 1
    `, params)

    if (!row) return null

    return {
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }
}


export const query_facts_in_range = async (
    subject?: string,
    predicate?: string,
    from?: Date,
    to?: Date,
    min_confidence: number = 0.1,
    user_id?: string
): Promise<TemporalFact[]> => {
    const conditions: string[] = []
    const params: any[] = []

    if (from && to) {
        const from_ts = from.getTime()
        const to_ts = to.getTime()
        conditions.push('((valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)) OR (valid_from >= ? AND valid_from <= ?))')
        params.push(to_ts, from_ts, from_ts, to_ts)
    } else if (from) {
        conditions.push('valid_from >= ?')
        params.push(from.getTime())
    } else if (to) {
        conditions.push('valid_from <= ?')
        params.push(to.getTime())
    }

    if (user_id) {
        conditions.push('user_id = ?')
        params.push(user_id)
    }

    if (subject) {
        conditions.push('subject = ?')
        params.push(subject)
    }

    if (predicate) {
        conditions.push('predicate = ?')
        params.push(predicate)
    }

    if (min_confidence > 0) {
        conditions.push('confidence >= ?')
        params.push(min_confidence)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
        FROM temporal_facts
        ${where}
        ORDER BY valid_from DESC
    `

    const rows = await all_async(sql, params)
    return rows.map(row => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }))
}


export const find_conflicting_facts = async (
    subject: string,
    predicate: string,
    at?: Date,
    user_id?: string
): Promise<TemporalFact[]> => {
    const timestamp = at ? at.getTime() : Date.now()
    const conditions = [
        'subject = ?',
        'predicate = ?',
        '(valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?))'
    ]
    const params: any[] = [subject, predicate, timestamp, timestamp]

    if (user_id) {
        conditions.push('user_id = ?')
        params.push(user_id)
    }

    const rows = await all_async(`
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
        FROM temporal_facts
        WHERE ${conditions.join(' AND ')}
        ORDER BY confidence DESC
    `, params)

    return rows.map(row => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }))
}


export const get_facts_by_subject = async (
    subject: string,
    at?: Date,
    include_historical: boolean = false,
    user_id?: string
): Promise<TemporalFact[]> => {
    let sql: string
    let params: any[]

    if (include_historical) {
        const conditions = ['subject = ?']
        params = [subject]
        
        if (user_id) {
            conditions.push('user_id = ?')
            params.push(user_id)
        }
        
        sql = `
            SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
            FROM temporal_facts
            WHERE ${conditions.join(' AND ')}
            ORDER BY predicate ASC, valid_from DESC
        `
    } else {
        const timestamp = at ? at.getTime() : Date.now()
        const conditions = [
            'subject = ?',
            '(valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?))'
        ]
        params = [subject, timestamp, timestamp]
        
        if (user_id) {
            conditions.push('user_id = ?')
            params.push(user_id)
        }
        
        sql = `
            SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
            FROM temporal_facts
            WHERE ${conditions.join(' AND ')}
            ORDER BY predicate ASC, confidence DESC
        `
    }

    const rows = await all_async(sql, params)
    return rows.map(row => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }))
}


export const search_facts = async (
    pattern: string,
    field: 'subject' | 'predicate' | 'object' = 'subject',
    at?: Date,
    user_id?: string
): Promise<TemporalFact[]> => {
    const timestamp = at ? at.getTime() : Date.now()
    const search_pattern = `%${pattern}%`
    const conditions = [
        `${field} LIKE ?`,
        '(valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?))'
    ]
    const params: any[] = [search_pattern, timestamp, timestamp]

    if (user_id) {
        conditions.push('user_id = ?')
        params.push(user_id)
    }

    const sql = `
        SELECT id, subject, predicate, object, valid_from, valid_to, confidence, last_updated, metadata, user_id
        FROM temporal_facts
        WHERE ${conditions.join(' AND ')}
        ORDER BY confidence DESC, valid_from DESC
        LIMIT 100
    `

    const rows = await all_async(sql, params)
    return rows.map(row => ({
        id: row.id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        // Convert timestamps to numbers first (they may be stored as strings in SQLite)
        valid_from: new Date(Number(row.valid_from)),
        valid_to: row.valid_to ? new Date(Number(row.valid_to)) : null,
        confidence: row.confidence,
        last_updated: new Date(Number(row.last_updated)),
        user_id: row.user_id,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }))
}


export const get_related_facts = async (
    fact_id: string,
    relation_type?: string,
    at?: Date,
    user_id?: string
): Promise<Array<{ fact: TemporalFact; relation: string; weight: number }>> => {
    const timestamp = at ? at.getTime() : Date.now()
    const conditions = ['(e.valid_from <= ? AND (e.valid_to IS NULL OR e.valid_to >= ?))']
    const params: any[] = [timestamp, timestamp]

    if (relation_type) {
        conditions.push('e.relation_type = ?')
        params.push(relation_type)
    }

    if (user_id) {
        conditions.push('e.user_id = ?')
        params.push(user_id)
    }

    const sql = `
        SELECT f.*, e.relation_type, e.weight, e.user_id as edge_user_id
        FROM temporal_edges e
        JOIN temporal_facts f ON e.target_id = f.id
        WHERE e.source_id = ?
        AND ${conditions.join(' AND ')}
        AND (f.valid_from <= ? AND (f.valid_to IS NULL OR f.valid_to >= ?))
        ${user_id ? 'AND f.user_id = ?' : ''}
        ORDER BY e.weight DESC, f.confidence DESC
    `

    const queryParams = user_id 
        ? [fact_id, ...params, timestamp, timestamp, user_id]
        : [fact_id, ...params, timestamp, timestamp]

    const rows = await all_async(sql, queryParams)
    return rows.map(row => ({
        fact: {
            id: row.id,
            subject: row.subject,
            predicate: row.predicate,
            object: row.object,
            valid_from: new Date(row.valid_from),
            valid_to: row.valid_to ? new Date(row.valid_to) : null,
            confidence: row.confidence,
            last_updated: new Date(row.last_updated),
            user_id: row.user_id,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined
        },
        relation: row.relation_type,
        weight: row.weight
    }))
}
