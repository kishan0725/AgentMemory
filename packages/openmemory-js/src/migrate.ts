#!/usr/bin/env node

import { run_migrations } from "./core/migrate";

run_migrations().catch((error) => {
    console.error("[MIGRATE] Failed:", error);
    process.exit(1);
});
