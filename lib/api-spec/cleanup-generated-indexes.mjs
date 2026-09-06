import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiSpecDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiSpecDir, "..", "..");

const indexes = [
  {
    path: path.join(
      workspaceRoot,
      "lib",
      "api-client-react",
      "src",
      "index.ts",
    ),
    preferredExports: [
      'export * from "./generated/api";',
      'export * from "./generated/api.schemas";',
    ],
  },
  {
    path: path.join(workspaceRoot, "lib", "api-zod", "src", "index.ts"),
    preferredExports: [
      'export { RemixJobResponse } from "./generated/api";',
      'export * from "./generated/api";',
      'export * from "./generated/types";',
    ],
  },
];

for (const index of indexes) {
  const source = await readFile(index.path, "utf8");
  const generatedExport = /^export \* from ['"]\.\/generated\/[^'"]+['"];?$/;
  const remixResponseExport =
    /^export \{ RemixJobResponse \} from ['"]\.\/generated\/api['"];?$/;
  const customLines = source
    .split(/\r?\n/)
    .filter(
      (line) =>
        line && !generatedExport.test(line) && !remixResponseExport.test(line),
    );
  const output = [...index.preferredExports, ...customLines, ""].join("\n");
  await writeFile(index.path, output);
}

const generatedEntryPoints = [
  path.join(
    workspaceRoot,
    "lib",
    "api-client-react",
    "src",
    "generated",
    "api.ts",
  ),
  path.join(
    workspaceRoot,
    "lib",
    "api-client-react",
    "src",
    "generated",
    "api.schemas.ts",
  ),
  path.join(
    workspaceRoot,
    "lib",
    "api-zod",
    "src",
    "generated",
    "api.ts",
  ),
];

for (const generatedFile of generatedEntryPoints) {
  const source = await readFile(generatedFile, "utf8");
  await writeFile(generatedFile, `${source.trimEnd()}\n`);
}