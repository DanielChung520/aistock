import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lf-coze-web-cdn.coze.cn',
        pathname: '/**',
      },
    ],
  },
  // Exclude Tauri Rust build artifacts from file watching to avoid ENOSPC / slow startup
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      ignored: [
        // Tauri Rust target dir (hundreds of thousands of fingerprint files)
        '**/src-tauri/target/**',
        '**/src-tauri/Cargo.lock',
        // pnpm internal symlinks
        '**/node_modules/.pnpm/**',
        // Build artifacts
        '**/.next/**',
        '**/.turbo/**',
      ],
    }
    return config
  },
  // Turbopack: ignore src-tauri from watching via the file system
  turbopack: {
    root: path.join(process.cwd()),
  },
}

export default nextConfig
