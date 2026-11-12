import fs from "node:fs";

type pg_password_provider = () => string | Promise<string>;

let provider: pg_password_provider | undefined;

// Read by pg on every new connection, so a provider set after import still applies.
export const set_pg_password_provider = (fn: pg_password_provider | undefined) => {
    provider = fn;
};

// Not read from the host's PG* env except PGPASSWORD, which pg used before a function was passed.
// pg accepts undefined at runtime (passwordless auth); its typings only allow string.
export const pg_password = (): string | Promise<string> =>
    provider ? provider() : (process.env.OM_PG_PASSWORD ?? process.env.PGPASSWORD) as string;

// `verify` checks the server certificate (plus the PEM at OM_PG_SSL_CA, e.g. the RDS bundle).
export const build_pg_ssl = (env: Record<string, string | undefined>) =>
    env.OM_PG_SSL === "require"
        ? { rejectUnauthorized: false }
        : env.OM_PG_SSL === "disable"
          ? false
          : env.OM_PG_SSL === "verify"
            ? {
                  rejectUnauthorized: true,
                  ca: env.OM_PG_SSL_CA ? fs.readFileSync(env.OM_PG_SSL_CA, "utf8") : undefined,
              }
            : undefined;
