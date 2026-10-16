/**
 * Creates (or resets the password of) a staff account.
 *   pnpm admin:create --email you@example.com --name "Your Name" [--role admin|editor]
 * The password is read from ADMIN_PASSWORD or prompted for (input hidden).
 */
import "./_env";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { env } from "@/lib/env";
import { AuthInputError, createUser, setPassword } from "@/lib/auth/sessions";

function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => write(s.startsWith(question) ? s : "");
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    }),
  );
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "admin" } } });
  const email = values.email ?? (await prompt("Email: "));
  const name = values.name ?? (await prompt("Display name: "));
  const role = values.role === "editor" ? "editor" : "admin";
  const password = process.env.ADMIN_PASSWORD ?? (await prompt("Password (min 12 chars): ", true));

  const e = env();
  const db = await createDb({ url: e.DATABASE_URL, dataDir: e.DATABASE_URL ? undefined : `${e.dataDir}/pglite`, poolMax: 1 });
  try {
    await migrate(db);
    const [existing] = await db.query<{ id: string }>("select id from users where lower(email) = lower($1)", [email]);
    if (existing) {
      await db.query("update users set role = $2, display_name = $3, disabled_at = null where id = $1", [existing.id, role, name]);
      await setPassword(db, existing.id, password);
      console.log(`> updated ${email} (${role}); existing sessions were signed out`);
    } else {
      await createUser(db, { email, password, displayName: name, role });
      console.log(`> created ${email} (${role})`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof AuthInputError ? `! ${err.message}` : err);
  process.exit(1);
});
