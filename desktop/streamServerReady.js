export function waitForReady({
  isReady,
  getError,
  readyPromise,
  timeoutMs
}) {
  if (isReady?.()) return Promise.resolve()
  const startupError = getError?.()
  if (startupError) return Promise.reject(startupError)
  if (!readyPromise) return Promise.reject(new Error('Local WebTorrent HTTP stream server was not created'))

  let timeout = null
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for local WebTorrent HTTP stream server`))
    }, timeoutMs)
    timeout.unref?.()
  })

  return Promise.race([readyPromise, timeoutPromise])
    .finally(() => clearTimeout(timeout))
}
