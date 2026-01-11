/**
 * FFI Library Finder
 * 
 * Locates the ToonDB native library for the current platform.
 * Search order matches Python SDK for consistency.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get the Rust target triple for the current platform
 */
function getTargetTriple(): string {
    const platform = os.platform();
    const arch = os.arch();

    if (platform === 'darwin') {
        return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    } else if (platform === 'linux') {
        return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
    } else if (platform === 'win32') {
        return arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'i686-pc-windows-msvc';
    }

    throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

/**
 * Get the library filename for the current platform
 */
function getLibraryFilename(): string {
    const platform = os.platform();

    if (platform === 'darwin') {
        return 'libtoondb_storage.dylib';
    } else if (platform === 'linux') {
        return 'libtoondb_storage.so';
    } else if (platform === 'win32') {
        return 'toondb_storage.dll';
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Find the ToonDB native library
 * 
 * Search order:
 * 1. TOONDB_LIB_PATH environment variable
 * 2. Bundled library in package (_bin/{target}/)
 * 3. Development build (../target/release, ../target/debug)
 * 4. System paths
 */
export function findLibrary(): string {
    const target = getTargetTriple();
    const filename = getLibraryFilename();

    // 1. Environment variable override
    if (process.env.TOONDB_LIB_PATH) {
        const envPath = process.env.TOONDB_LIB_PATH;
        if (fs.existsSync(envPath)) {
            return envPath;
        }
    }

    const searchPaths: string[] = [
        // 2. Bundled in package (from dist/cjs or dist/esm)
        path.join(__dirname, '..', '..', '..', '_bin', target, filename),
        path.join(__dirname, '..', '..', '_bin', target, filename),
        path.join(__dirname, '..', '_bin', target, filename),

        // 3. Development paths - from project root
        path.join(__dirname, '..', '..', '..', 'target', 'release', filename),
        path.join(__dirname, '..', '..', '..', 'target', 'debug', filename),
        path.join(__dirname, '..', '..', 'target', 'release', filename),
        path.join(__dirname, '..', '..', 'target', 'debug', filename),

        // From toondb monorepo (../../toondb/target/release)
        path.join(__dirname, '..', '..', '..', '..', 'toondb', 'target', 'release', filename),

        // Absolute paths
        path.resolve(process.cwd(), '_bin', target, filename),
        path.resolve(process.cwd(), 'target', 'release', filename),
        path.resolve(process.cwd(), '..', 'target', 'release', filename),
    ];

    // Search for library
    for (const searchPath of searchPaths) {
        if (fs.existsSync(searchPath)) {
            return path.resolve(searchPath);
        }
    }

    // 4. Try system paths (LD_LIBRARY_PATH, DYLD_LIBRARY_PATH, PATH)
    const systemPaths = (process.env.LD_LIBRARY_PATH ||
        process.env.DYLD_LIBRARY_PATH ||
        process.env.PATH || '').split(path.delimiter);

    for (const dir of systemPaths) {
        const libPath = path.join(dir, filename);
        if (fs.existsSync(libPath)) {
            return path.resolve(libPath);
        }
    }

    throw new Error(
        `Could not find ToonDB native library (${filename}). ` +
        `Searched in: ${searchPaths.join(', ')}. ` +
        `Set TOONDB_LIB_PATH environment variable or build the library.`
    );
}
