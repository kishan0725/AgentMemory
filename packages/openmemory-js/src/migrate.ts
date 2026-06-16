#!/usr/bin/env node

import { run_migrations } from "./core/migrate";

console.log("[MIGRATE] agent-memory migration command started");

run_migrations().catch((error) => {
    console.error("[MIGRATE] Failed:", error);
    process.exit(1);
});
