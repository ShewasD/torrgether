export function shouldDisableHardwareAcceleration({
  env = process.env,
  platform = process.platform
} = {}) {
  const override = String(env.TORRGETHER_DISABLE_GPU ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(override)) return true
  if (['0', 'false', 'no', 'off'].includes(override)) return false
  return platform === 'linux'
}
