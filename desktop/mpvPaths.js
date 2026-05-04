import path from 'path'

function pushCandidate(candidates, candidate) {
  if (!candidate) return
  const value = String(candidate)
  if (!candidates.includes(value)) candidates.push(value)
}

function joinIfBase(pathApi, base, ...parts) {
  return base ? pathApi.join(base, ...parts) : null
}

export function getMpvCandidates({
  env = process.env,
  platform = process.platform,
  appDir = process.cwd(),
  resourcesPath = process.resourcesPath,
  execPath = process.execPath
} = {}) {
  const candidates = []
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const exeName = platform === 'win32' ? 'mpv.exe' : 'mpv'
  const execDir = execPath && pathApi.dirname(execPath) !== '.' ? pathApi.dirname(execPath) : null

  pushCandidate(candidates, env.MPV_PATH)
  pushCandidate(candidates, joinIfBase(pathApi, resourcesPath, 'bin', exeName))
  pushCandidate(candidates, joinIfBase(pathApi, resourcesPath, exeName))
  pushCandidate(candidates, joinIfBase(pathApi, execDir, 'bin', exeName))
  pushCandidate(candidates, joinIfBase(pathApi, execDir, exeName))
  pushCandidate(candidates, joinIfBase(pathApi, appDir, 'bin', exeName))
  pushCandidate(candidates, joinIfBase(pathApi, appDir, exeName))
  pushCandidate(candidates, exeName)

  if (platform === 'win32') {
    pushCandidate(candidates, joinIfBase(pathApi, env.USERPROFILE, 'scoop', 'shims', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.USERPROFILE, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.ChocolateyInstall, 'bin', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.ProgramData, 'chocolatey', 'bin', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.LOCALAPPDATA, 'mpv', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env.ProgramFiles, 'mpv', 'mpv.exe'))
    pushCandidate(candidates, joinIfBase(pathApi, env['ProgramFiles(x86)'], 'mpv', 'mpv.exe'))
    return candidates
  }

  pushCandidate(candidates, '/usr/bin/mpv')
  pushCandidate(candidates, '/usr/local/bin/mpv')
  pushCandidate(candidates, '/snap/bin/mpv')
  pushCandidate(candidates, '/opt/homebrew/bin/mpv')
  return candidates
}
