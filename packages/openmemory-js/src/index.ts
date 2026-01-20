// Export core functionality for use as a package
export * from "./core/memory";
// Export new unified API types
export type { RecallOptions, RecallResult, StoreOptions, StoreResult } from "./core/memory";
// NOTE: Do NOT export server/index as it auto-starts the HTTP server
// export * from "./server/index";  // Commented out to prevent auto-start
export * from "./ops/ingest";
export * as sources from "./sources";

// Export temporal graph types and functions
export * from "./temporal_graph/types";
export * from "./temporal_graph/store";
export * from "./temporal_graph/query";

// Export HSG (semantic memory) functions - used by MCP tools
export {
    add_hsg_memory,
    hsg_query,
    reinforce_memory,
    update_memory,
    sector_configs,
    sectors,
} from "./memory/hsg";

// Export HSG types
export type {
    hsg_q_result,
    hsg_mem,
    sector_cfg,
    sector_class,
} from "./memory/hsg";


// Export utility functions
export { j, p } from "./utils";

// Export user summary function
export { update_user_summary } from "./memory/user_summary";

// Export core types
export type { mem_row, sector_type } from "./core/types";
