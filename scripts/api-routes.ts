import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Every API route and page, found by reading src/app rather than typed out.
 *
 * The verification suites that sweep "every route" use this, so a route added
 * later is swept the day it is written. A typed list is how suites quietly
 * stopped covering things before (see the verification notes).
 */

export type ApiHandler = {
  /** The URL path with each dynamic segment filled with a fresh UUID. */
  path: string;
  /** The file under src/app/api, for messages. */
  file: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
};

const DUMMY_ID = "00000000-0000-4000-8000-000000000000";

function urlFor(segments: string[]): string {
  return (
    "/" +
    segments
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (/^\[\.\.\..*\]$/.test(s) ? "x" : /^\[.*\]$/.test(s) ? DUMMY_ID : s))
      .join("/")
  );
}

export function apiHandlers(root = join(process.cwd(), "src", "app", "api")): ApiHandler[] {
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) =>
    /route\.tsx?$/.test(f),
  );
  return files.flatMap((file) => {
    const source = readFileSync(join(root, file), "utf8");
    const segments = ["api", ...file.split(sep).slice(0, -1)];
    return [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].map(
      (m) => ({ path: urlFor(segments), file, method: m[1] as ApiHandler["method"] }),
    );
  });
}

/** Every page under src/app/admin, as a URL with dynamic segments filled. */
export function adminPages(root = join(process.cwd(), "src", "app", "admin")): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((f) => /(^|[\\/])page\.tsx$/.test(f))
    .map((f) => urlFor(["admin", ...f.split(sep).slice(0, -1)]));
}
