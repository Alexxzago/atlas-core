export function cleanMarkdown(markdown: string): string {
  const ignoredPatterns = [
    /cookie/i,
    /privacy policy/i,
    /terms of use/i,
    /all rights reserved/i,
    /advertisement/i,
    /sign in/i,
    /log in/i,
    /subscribe/i,
  ];

  const cleanedLines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .filter((line) => !ignoredPatterns.some((pattern) => pattern.test(line)));

  const uniqueLines = [...new Set(cleanedLines)];

  return uniqueLines.join("\n").slice(0, 30_000);
}