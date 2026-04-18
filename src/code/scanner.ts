/**
 * FileScanner - Discovers code files in a directory while respecting ignore patterns
 */

import { promises as fs } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import ignore, { type Ignore } from "ignore";
import type { ScannerConfig } from "./types.js";

export class ScanError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "ScanError";
  }
}

export class FileScanner {
  private ig: Ignore = ignore();
  private supportedExts: Set<string>;

  constructor(private config: ScannerConfig) {
    this.supportedExts = new Set(config.supportedExtensions);
  }

  /**
   * Load ignore patterns from .gitignore, .dockerignore, .npmignore, and .contextignore
   */
  async loadIgnorePatterns(rootPath: string): Promise<void> {
    const ignoreFiles = [".gitignore", ".dockerignore", ".npmignore", ".contextignore"];

    for (const ignoreFile of ignoreFiles) {
      const ignorePath = join(rootPath, ignoreFile);
      if (await this.fileExists(ignorePath)) {
        try {
          const content = await fs.readFile(ignorePath, "utf-8");
          this.ig.add(content);
        } catch (_error) {
          // Silently skip if file can't be read
        }
      }
    }

    // Add default patterns from config
    if (this.config.ignorePatterns && this.config.ignorePatterns.length > 0) {
      this.ig.add(this.config.ignorePatterns);
    }

    // Add custom patterns
    if (this.config.customIgnorePatterns && this.config.customIgnorePatterns.length > 0) {
      this.ig.add(this.config.customIgnorePatterns);
    }
  }

  /**
   * Scan directory recursively and return all code files
   */
  async scanDirectory(rootPath: string): Promise<string[]> {
    const absoluteRoot = resolve(rootPath);
    const files: string[] = [];
    const visitedRealPaths = new Set<string>();

    // Verify the root path is accessible before walking
    try {
      await fs.access(absoluteRoot);
    } catch (error) {
      throw new ScanError(`Cannot access directory: ${absoluteRoot}`, absoluteRoot, error);
    }

    await this.walkDirectory(absoluteRoot, absoluteRoot, files, visitedRealPaths);

    return files;
  }

  /**
   * Check if a file should be ignored based on patterns
   */
  shouldIgnore(filePath: string, rootPath: string): boolean {
    const relativePath = relative(rootPath, filePath);
    return this.ig.ignores(relativePath);
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.supportedExts);
  }

  /**
   * Recursively walk directory tree
   */
  private async walkDirectory(
    currentPath: string,
    rootPath: string,
    files: string[],
    visitedRealPaths: Set<string>
  ): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(rootPath, fullPath);

      // Skip ignored paths
      if (this.ig.ignores(relativePath)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        // Resolve the symlink to its real path to detect cycles
        let realPath: string;
        try {
          realPath = await fs.realpath(fullPath);
        } catch {
          // Broken symlink — skip
          continue;
        }

        // Skip if we've already visited this real path (cycle prevention)
        if (visitedRealPaths.has(realPath)) {
          continue;
        }

        // Check what the symlink points to
        let stat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          visitedRealPaths.add(realPath);
          try {
            await this.walkDirectory(realPath, rootPath, files, visitedRealPaths);
          } catch {
            // Skip unreadable symlinked directories
          }
        } else if (stat.isFile()) {
          const ext = extname(entry.name);
          if (this.supportedExts.has(ext)) {
            files.push(fullPath);
          }
        }
      } else if (entry.isDirectory()) {
        try {
          const realPath = await fs.realpath(fullPath);
          if (visitedRealPaths.has(realPath)) {
            continue;
          }
          visitedRealPaths.add(realPath);
          await this.walkDirectory(fullPath, rootPath, files, visitedRealPaths);
        } catch {
          // Skip directories that can't be read (permission errors, etc.)
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (this.supportedExts.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
