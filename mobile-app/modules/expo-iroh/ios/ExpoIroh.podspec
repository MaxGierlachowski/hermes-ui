require 'json'

Pod::Spec.new do |s|
  s.name           = 'ExpoIroh'
  s.version        = '0.1.0'
  s.summary        = 'iroh-fetch for React Native: HTTP over iroh to an iroh-bridge gateway, native Rust client (UniFFI)'
  s.license        = 'MIT'
  s.author         = 'hermes-ui'
  s.homepage       = 'https://github.com/MaxGierlachowski/hermes-ui'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Rust library + C header from ../scripts/build-ios.sh; the generated Swift bindings are compiled here.
  s.vendored_frameworks = 'HermesIrohFFI.xcframework'
  s.source_files = 'ExpoIrohModule.swift', 'Generated/hermes_iroh.swift'
  s.frameworks = 'SystemConfiguration', 'Security', 'CoreFoundation'
  # The XCFramework has arm64 slices only (devices, Apple-silicon simulators): a simulator build that
  # also targets x86_64 (Release, generic destination) would find no Rust library for that slice.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
  }
  s.user_target_xcconfig = { 'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64' }
end
