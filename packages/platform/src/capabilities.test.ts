// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describePlatformSecurity, getPlatformKeyProtection, requireSupportedDesktopPlatform } from './capabilities'

describe('desktop platform security capabilities', () => {
  it('maps Electron safeStorage to the real OS key provider', () => {
    expect(getPlatformKeyProtection('darwin')).toBe('macos-keychain')
    expect(getPlatformKeyProtection('win32')).toBe('windows-dpapi')
    expect(() => requireSupportedDesktopPlatform('linux')).toThrow('Unsupported desktop platform')
  })

  it('keeps Windows release blocked until OCR and kernel isolation evidence exist', () => {
    expect(describePlatformSecurity({ platform: 'win32' })).toMatchObject({
      keyProtection: 'windows-dpapi',
      localOcr: { enabled: false, kernelNetworkIsolation: 'windows-kernel-network-required' },
      rawPersonalDataCloudEligible: false,
      releaseBlockers: expect.arrayContaining([
        'WINDOWS_OFFLINE_OCR_RUNTIME_NOT_BUNDLED',
        'WINDOWS_OCR_KERNEL_NETWORK_POLICY_NOT_VERIFIED',
        'WINDOWS_LOCAL_WORKER_KERNEL_NETWORK_POLICY_NOT_VERIFIED'
      ])
    })
  })

  it('requires a separate Windows worker policy even after the offline OCR worker is verified', () => {
    const capabilities = describePlatformSecurity({
      platform: 'win32',
      windowsOcrRuntimeBundled: true,
      windowsOcrKernelNetworkVerified: true
    })
    expect(capabilities.localOcr).toMatchObject({ enabled: true, kernelNetworkIsolation: 'windows-kernel-network-verified' })
    expect(capabilities.releaseBlockers).toEqual(['WINDOWS_LOCAL_WORKER_KERNEL_NETWORK_POLICY_NOT_VERIFIED'])
  })
})
