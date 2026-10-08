/**
 * Identity of a git repository across machines: the lower-case "owner/repo" path of its remote,
 * without scheme, user, host or ".git". Hosts are dropped on purpose so SSH host aliases
 * (git@github-work:acme/site.git) and HTTPS URLs (https://github.com/acme/site) still match.
 */
export function remoteKey(url: string | null | undefined): string | null {
  if (!url) return null
  let rest = url.trim()
  rest = rest.replace(/^[a-z+]+:\/\//i, '') // scheme
  rest = rest.replace(/^[^@/]+@/, '') // user@
  // host: "host:path" (scp-like) or "host/path"
  const scp = /^[^/:]+:(?!\d+\/)(.+)$/.exec(rest)
  rest = scp ? scp[1] : rest.replace(/^[^/]+\//, '')
  rest = rest.replace(/\.git\/?$/i, '').replace(/\/+$/, '').replace(/^\/+/, '')
  const parts = rest.split('/').filter(Boolean)
  if (parts.length < 2) return null
  return parts.slice(-2).join('/').toLowerCase()
}
