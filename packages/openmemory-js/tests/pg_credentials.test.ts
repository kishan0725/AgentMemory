import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build_pg_ssl, pg_password, set_pg_password_provider } from "../src/core/pg_credentials";

beforeEach(() => {
    set_pg_password_provider(undefined);
    delete process.env.OM_PG_PASSWORD;
    delete process.env.PGPASSWORD;
});

test("provider value is used on every call and can be replaced later", async () => {
    let n = 0;
    set_pg_password_provider(async () => `tok${++n}`);
    assert.equal(await pg_password(), "tok1");
    assert.equal(await pg_password(), "tok2");
    set_pg_password_provider(() => "other");
    assert.equal(await pg_password(), "other");
});

test("without a provider OM_PG_PASSWORD wins, then PGPASSWORD", () => {
    assert.equal(pg_password(), undefined);
    process.env.PGPASSWORD = "host";
    assert.equal(pg_password(), "host");
    process.env.OM_PG_PASSWORD = "om";
    assert.equal(pg_password(), "om");
});

test("OM_PG_SSL require, disable and unset keep their old meaning", () => {
    assert.deepEqual(build_pg_ssl({ OM_PG_SSL: "require" }), { rejectUnauthorized: false });
    assert.equal(build_pg_ssl({ OM_PG_SSL: "disable" }), false);
    assert.equal(build_pg_ssl({}), undefined);
    assert.equal(build_pg_ssl({ OM_PG_SSL: "Require" }), undefined);
});

test("OM_PG_SSL=verify checks the certificate and loads OM_PG_SSL_CA", () => {
    assert.deepEqual(build_pg_ssl({ OM_PG_SSL: "verify" }), { rejectUnauthorized: true, ca: undefined });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "om-ca-")), "ca.pem");
    fs.writeFileSync(file, "PEM");
    assert.deepEqual(build_pg_ssl({ OM_PG_SSL: "verify", OM_PG_SSL_CA: file }), { rejectUnauthorized: true, ca: "PEM" });
    assert.throws(() => build_pg_ssl({ OM_PG_SSL: "verify", OM_PG_SSL_CA: "/nope/ca.pem" }));
});
