import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MarkdownDebugStore } from "../types/ports.js";

export class FileMarkdownDebugStore implements MarkdownDebugStore {
  public constructor(private readonly directory: string) {}

  public async save(companyId: number, markdown: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      resolve(this.directory, `company-${companyId}.md`),
      markdown,
      "utf8"
    );
  }
}
