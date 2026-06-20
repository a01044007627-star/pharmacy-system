import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const files = ["pnpm-lock.yaml", "package-lock.json"];
const targetPattern = /https:\/\/packages\.applied-caas-gateway1\.internal\.api\.openai\.org\/artifactory\/api\/npm\/npm-public\//g;
const replacement = "https://registry.npmjs.org/";

for (const file of files) {
  const filePath = resolve(process.cwd(), file);
  if (existsSync(filePath)) {
    console.log(`[sanitize-lockfiles] Checking ${file}...`);
    const content = readFileSync(filePath, "utf8");
    if (content.match(targetPattern)) {
      const updatedContent = content.replace(targetPattern, replacement);
      writeFileSync(filePath, updatedContent, "utf8");
      console.log(`[sanitize-lockfiles] Successfully replaced internal URLs in ${file}`);
    } else {
      console.log(`[sanitize-lockfiles] No internal URLs found in ${file}`);
    }
  }
}
