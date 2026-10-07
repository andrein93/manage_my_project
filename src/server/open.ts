import { spawn } from 'node:child_process'

export interface Opener {
  folder(path: string): void
  url(url: string): void
}

/** Opens folders and URLs with the OS default handler, never through a shell. */
export const systemOpener: Opener = {
  folder: (path) => launch(path, false),
  url: (url) => launch(url, true),
}

export const openUrl = (url: string): void => systemOpener.url(url)

/** `vscode://file/...` URL; works on every OS where VS Code is installed. */
export function vscodeUrl(path: string): string {
  return 'vscode://file/' + encodeURI(path.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

function launch(target: string, isUrl: boolean): void {
  const [command, args] =
    process.platform === 'win32'
      ? isUrl
        ? ['rundll32', ['url.dll,FileProtocolHandler', target]]
        : ['explorer.exe', [target]]
      : process.platform === 'darwin'
        ? ['open', isUrl ? [target] : ['-a', 'Finder', target]]
        : ['xdg-open', [target]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}
