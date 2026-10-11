/**
 * ow (opencode-web) 伺服器位址。
 *
 * 依瀏覽端所在的 host 動態組出 URL：
 * - 本機開 localhost:33300 → http://localhost:14096
 * - 區網開 192.168.1.108:33300 → http://192.168.1.108:14096
 *
 * 可用 NEXT_PUBLIC_OW_URL 覆寫（部署在反向代理後等情境）。
 * 遠端（Cloudflare tunnel）走 .env.local 的 NEXT_PUBLIC_OW_URL=https://ow2.aiconn.ai。
 */
const envUrl = process.env.NEXT_PUBLIC_OW_URL

export function getOwUrl(): string {
  if (envUrl) return envUrl
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname
  return `http://${host}:14096`
}
