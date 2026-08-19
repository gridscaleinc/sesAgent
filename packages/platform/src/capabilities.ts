export type SupportedDesktopPlatform = 'darwin' | 'win32'
export type PlatformKeyProtection = 'macos-keychain' | 'windows-dpapi'

export interface PlatformSecurityCapabilities {
  platform: SupportedDesktopPlatform
  keyProtection: PlatformKeyProtection
  packageTarget: 'dmg' | 'nsis'
  localOcr: {
    adapter: 'apple-vision' | 'windows-tesseract-wasm'
    enabled: boolean
    kernelNetworkIsolation: 'sandbox-exec-deny-network' | 'windows-kernel-network-verified' | 'windows-kernel-network-required'
  }
  localWorkers: {
    nodeNetworkDenyGuard: true
    kernelNetworkIsolation: 'sandbox-exec-deny-network' | 'windows-kernel-network-verified' | 'windows-release-policy-required'
  }
  rawPersonalDataCloudEligible: false
  releaseBlockers: string[]
}

export function requireSupportedDesktopPlatform(platform: NodeJS.Platform): SupportedDesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform
  throw new Error(`Unsupported desktop platform: ${platform}`)
}

export function getPlatformKeyProtection(platform: NodeJS.Platform): PlatformKeyProtection {
  return requireSupportedDesktopPlatform(platform) === 'win32' ? 'windows-dpapi' : 'macos-keychain'
}

export function describePlatformSecurity(options: {
  platform: NodeJS.Platform
  windowsOcrRuntimeBundled?: boolean
  windowsOcrKernelNetworkVerified?: boolean
  windowsLocalWorkerKernelNetworkVerified?: boolean
}): PlatformSecurityCapabilities {
  const platform = requireSupportedDesktopPlatform(options.platform)
  if (platform === 'darwin') {
    return {
      platform,
      keyProtection: 'macos-keychain',
      packageTarget: 'dmg',
      localOcr: {
        adapter: 'apple-vision',
        enabled: true,
        kernelNetworkIsolation: 'sandbox-exec-deny-network'
      },
      localWorkers: {
        nodeNetworkDenyGuard: true,
        kernelNetworkIsolation: 'sandbox-exec-deny-network'
      },
      rawPersonalDataCloudEligible: false,
      releaseBlockers: []
    }
  }

  const runtimeBundled = options.windowsOcrRuntimeBundled === true
  const ocrKernelNetworkVerified = options.windowsOcrKernelNetworkVerified === true
  const localWorkerKernelNetworkVerified = options.windowsLocalWorkerKernelNetworkVerified === true
  const releaseBlockers = [
    ...(!runtimeBundled ? ['WINDOWS_OFFLINE_OCR_RUNTIME_NOT_BUNDLED'] : []),
    ...(!ocrKernelNetworkVerified ? ['WINDOWS_OCR_KERNEL_NETWORK_POLICY_NOT_VERIFIED'] : []),
    ...(!localWorkerKernelNetworkVerified ? ['WINDOWS_LOCAL_WORKER_KERNEL_NETWORK_POLICY_NOT_VERIFIED'] : [])
  ]
  return {
    platform,
    keyProtection: 'windows-dpapi',
    packageTarget: 'nsis',
    localOcr: {
      adapter: 'windows-tesseract-wasm',
      enabled: runtimeBundled && ocrKernelNetworkVerified,
      kernelNetworkIsolation: ocrKernelNetworkVerified ? 'windows-kernel-network-verified' : 'windows-kernel-network-required'
    },
    localWorkers: {
      nodeNetworkDenyGuard: true,
      kernelNetworkIsolation: localWorkerKernelNetworkVerified ? 'windows-kernel-network-verified' : 'windows-release-policy-required'
    },
    rawPersonalDataCloudEligible: false,
    releaseBlockers
  }
}
