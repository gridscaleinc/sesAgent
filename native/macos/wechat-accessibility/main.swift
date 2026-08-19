import AppKit
import ApplicationServices
import Darwin
import Foundation
import ScreenCaptureKit
import Security
import Vision

private let primaryWechatBundleIdentifier = "com.tencent.xinWeChat"
private let expectedWechatTeamIdentifier = "5A4RE8SF68"
private let supportedWechatBundleIdentifiers = [
    primaryWechatBundleIdentifier,
    "com.tencent.flue.WeChatAppEx"
]
private let maximumTraversalDepth = 80
private let maximumVisitedElements = 20_000
private let maximumTextNodes = 300
private let maximumRawTextBytes = 100_000

struct RectValue: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.size.width
        height = rect.size.height
    }

    var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

struct WechatProcessIdentity: Codable {
    let bundleIdentifier: String
    let processIdentifier: Int32
    let launchDate: String
    let version: String
    let buildVersion: String
    let active: Bool
    let signatureIdentifier: String
    let teamIdentifier: String
    let signatureValid: Bool
}

struct PreflightOutput: Codable {
    let version: String
    let platform: String
    let accessibilityTrusted: Bool
    let screenCaptureTrusted: Bool
    let windowCaptureAvailable: Bool
    let helperNetworkAccess: Bool
    let supportedBundleIdentifiers: [String]
    let processes: [WechatProcessIdentity]
}

struct ContainerEvidence: Codable {
    let role: String
    let frame: RectValue
    let visibleTextNodeCount: Int
    let visibleCharacterCount: Int
    let depth: Int
}

struct ProbeOutput: Codable {
    let version: String
    let bundleIdentifier: String
    let processIdentifier: Int32
    let launchDate: String
    let focusedWindowFrame: RectValue
    let visitedElementCount: Int
    let roleCounts: [String: Int]
    let readableTextNodeCount: Int
    let readableCharacterCount: Int
    let candidateContainers: [ContainerEvidence]
    let selectedContainer: ContainerEvidence?
    let helperNetworkAccess: Bool
}

struct VisibleTextNode: Codable {
    let role: String
    let text: String
    let frame: RectValue
}

struct ReadOutput: Codable {
    let version: String
    let bundleIdentifier: String
    let processIdentifier: Int32
    let launchDate: String
    let focusedWindowFrame: RectValue
    let selectedContainerFrame: RectValue
    let nodes: [VisibleTextNode]
    let rawUtf8Bytes: Int
    let truncated: Bool
    let helperNetworkAccess: Bool
    let scope: String
    let captureMethod: String
}

struct CaptureProbeOutput: Codable {
    let version: String
    let bundleIdentifier: String
    let processIdentifier: Int32
    let focusedWindowFrame: RectValue
    let capturedWindowFrame: RectValue
    let imageWidth: Int
    let imageHeight: Int
    let conversationCrop: RectValue
    let fullWindowRecognizedTextNodeCount: Int
    let conversationRecognizedTextNodeCount: Int
    let helperNetworkAccess: Bool
}

struct ReadMetadataOutput: Codable {
    let version: String
    let captureMethod: String
    let nodeCount: Int
    let rawUtf8Bytes: Int
    let truncated: Bool
    let scope: String
    let helperNetworkAccess: Bool
    let focusedWindowFrame: RectValue
    let selectedContainerFrame: RectValue
}

struct ActivationOutput: Codable {
    let version: String
    let bundleIdentifier: String
    let processIdentifier: Int32
    let launchDate: String
    let activated: Bool
    let helperNetworkAccess: Bool
}

struct NetworkProbeOutput: Codable {
    let version: String
    let loopbackDeniedBySandbox: Bool
    let externalDeniedBySandbox: Bool
    let loopbackErrno: Int32
    let externalErrno: Int32
    let helperNetworkAccess: Bool
}

struct ErrorOutput: Codable {
    let errorCode: String
    let message: String
}

enum WechatAccessibilityError: Error {
    case invalidArguments
    case accessibilityPermissionRequired
    case targetNotRunning
    case targetNotFrontmost
    case targetProcessChanged
    case focusedWindowUnavailable
    case focusedWindowFrameUnavailable
    case visibleConversationContainerUnavailable
    case visibleMessageTextUnavailable
    case traversalLimitExceeded
    case screenCapturePermissionRequired
    case screenCaptureUnavailable
    case windowCaptureUnavailable
    case visionRecognitionFailed
    case targetSignatureUntrusted
}

private let iso8601WithFractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

func writeJson<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func runningWechatProcesses() -> [NSRunningApplication] {
    NSWorkspace.shared.runningApplications
        .filter { application in
            guard let bundleIdentifier = application.bundleIdentifier else { return false }
            return supportedWechatBundleIdentifiers.contains(bundleIdentifier) && !application.isTerminated
        }
        .sorted { $0.processIdentifier < $1.processIdentifier }
}

func bundleVersions(_ application: NSRunningApplication) -> (String, String) {
    guard let bundleURL = application.bundleURL,
          let bundle = Bundle(url: bundleURL) else { return ("unknown", "unknown") }
    let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
    let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    return (version, build)
}

func processLaunchDate(_ application: NSRunningApplication) -> String {
    guard let date = application.launchDate else { return "unknown" }
    return iso8601WithFractionalSeconds.string(from: date)
}

func processIdentity(_ application: NSRunningApplication) -> WechatProcessIdentity {
    let versions = bundleVersions(application)
    let signature = codeSignatureIdentity(application)
    return WechatProcessIdentity(
        bundleIdentifier: application.bundleIdentifier ?? "unknown",
        processIdentifier: application.processIdentifier,
        launchDate: processLaunchDate(application),
        version: versions.0,
        buildVersion: versions.1,
        active: application.isActive,
        signatureIdentifier: signature.identifier,
        teamIdentifier: signature.teamIdentifier,
        signatureValid: signature.valid
    )
}

func codeSignatureIdentity(_ application: NSRunningApplication) -> (identifier: String, teamIdentifier: String, valid: Bool) {
    guard let bundleURL = application.bundleURL else { return ("unknown", "unknown", false) }
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(bundleURL as CFURL, SecCSFlags(rawValue: 0), &staticCode) == errSecSuccess,
          let staticCode else { return ("unknown", "unknown", false) }
    let validity = SecStaticCodeCheckValidity(staticCode, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess
    var rawInformation: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &rawInformation) == errSecSuccess,
          let information = rawInformation as? [String: Any] else { return ("unknown", "unknown", false) }
    let identifier = information[kSecCodeInfoIdentifier as String] as? String ?? "unknown"
    let teamIdentifier = information[kSecCodeInfoTeamIdentifier as String] as? String ?? "unknown"
    return (identifier, teamIdentifier, validity)
}

func hasTrustedWechatSignature(_ application: NSRunningApplication) -> Bool {
    let signature = codeSignatureIdentity(application)
    return signature.valid &&
        signature.teamIdentifier == expectedWechatTeamIdentifier &&
        supportedWechatBundleIdentifiers.contains(signature.identifier)
}

func accessibilityTrusted(prompt: Bool) -> Bool {
    let option = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([option: prompt] as CFDictionary)
}

func screenCaptureTrusted(prompt: Bool) -> Bool {
    if CGPreflightScreenCaptureAccess() { return true }
    return prompt ? CGRequestScreenCaptureAccess() : false
}

func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value
}

func stringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
    guard let value = copyAttribute(element, attribute) else { return nil }
    if CFGetTypeID(value) == CFStringGetTypeID() {
        return (value as! String).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if CFGetTypeID(value) == CFAttributedStringGetTypeID() {
        return (value as! NSAttributedString).string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return nil
}

func boolAttribute(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
    guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
    return CFBooleanGetValue((value as! CFBoolean))
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    let attributes = [kAXVisibleChildrenAttribute, kAXChildrenAttribute]
    for attribute in attributes {
        guard let value = copyAttribute(element, attribute as CFString), CFGetTypeID(value) == CFArrayGetTypeID() else { continue }
        let array = value as! [AnyObject]
        let elements = array.compactMap { item -> AXUIElement? in
            guard CFGetTypeID(item) == AXUIElementGetTypeID() else { return nil }
            return (item as! AXUIElement)
        }
        if !elements.isEmpty { return elements }
    }
    return []
}

func pointAttribute(_ element: AXUIElement, _ attribute: CFString) -> CGPoint? {
    guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgPoint else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
}

func sizeAttribute(_ element: AXUIElement, _ attribute: CFString) -> CGSize? {
    guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgSize else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(axValue, .cgSize, &size) ? size : nil
}

func frame(_ element: AXUIElement) -> CGRect? {
    guard let position = pointAttribute(element, kAXPositionAttribute as CFString),
          let size = sizeAttribute(element, kAXSizeAttribute as CFString),
          size.width > 0, size.height > 0,
          position.x.isFinite, position.y.isFinite, size.width.isFinite, size.height.isFinite else { return nil }
    return CGRect(origin: position, size: size)
}

func isVisible(_ element: AXUIElement, frame elementFrame: CGRect, inside scopeFrame: CGRect) -> Bool {
    if boolAttribute(element, kAXHiddenAttribute as CFString) == true { return false }
    if boolAttribute(element, kAXEnabledAttribute as CFString) == false { return false }
    let intersection = elementFrame.intersection(scopeFrame)
    return !intersection.isNull && intersection.width >= 1 && intersection.height >= 1
}

func readableText(_ element: AXUIElement, role: String) -> String? {
    let acceptedRoles: Set<String> = [
        kAXStaticTextRole as String,
        kAXHeadingRole as String
    ]
    guard acceptedRoles.contains(role) else { return nil }
    let candidates = [
        stringAttribute(element, kAXValueAttribute as CFString),
        stringAttribute(element, kAXTitleAttribute as CFString),
        stringAttribute(element, kAXDescriptionAttribute as CFString)
    ]
    guard let text = candidates.compactMap({ $0 }).first(where: { !$0.isEmpty }) else { return nil }
    let normalized = text.replacingOccurrences(of: "\u{0000}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.utf8.count <= maximumRawTextBytes else { return nil }
    return normalized
}

struct TraversedElement {
    let element: AXUIElement
    let role: String
    let frame: CGRect
    let depth: Int
    let text: String?
}

func traverse(_ root: AXUIElement, windowFrame: CGRect) throws -> [TraversedElement] {
    var result: [TraversedElement] = []
    var stack: [(AXUIElement, Int)] = [(root, 0)]
    while let (element, depth) = stack.popLast() {
        if result.count >= maximumVisitedElements { throw WechatAccessibilityError.traversalLimitExceeded }
        if depth > maximumTraversalDepth { continue }
        guard let elementFrame = frame(element), isVisible(element, frame: elementFrame, inside: windowFrame) else { continue }
        let role = stringAttribute(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        result.append(TraversedElement(
            element: element,
            role: role,
            frame: elementFrame,
            depth: depth,
            text: readableText(element, role: role)
        ))
        for child in children(element).reversed() { stack.append((child, depth + 1)) }
    }
    return result
}

func selectedConversationContainer(
    traversed: [TraversedElement],
    windowFrame: CGRect
) -> (TraversedElement, [TraversedElement], [ContainerEvidence])? {
    let acceptedContainerRoles: Set<String> = [
        kAXScrollAreaRole as String,
        kAXListRole as String,
        kAXGroupRole as String
    ]
    let contentBoundary = windowFrame.minX + windowFrame.width * 0.38
    var candidates: [(TraversedElement, [TraversedElement], ContainerEvidence, Double)] = []
    for container in traversed where acceptedContainerRoles.contains(container.role) {
        guard container.frame.minX >= contentBoundary - 8,
              container.frame.width >= windowFrame.width * 0.30,
              container.frame.height >= windowFrame.height * 0.30,
              container.frame.maxX <= windowFrame.maxX + 8,
              container.frame.maxY <= windowFrame.maxY + 8 else { continue }
        let textNodes = traversed.filter { node in
            guard node.text != nil, node.depth > container.depth else { return false }
            let midpoint = CGPoint(x: node.frame.midX, y: node.frame.midY)
            return container.frame.contains(midpoint)
        }
        guard !textNodes.isEmpty else { continue }
        let characters = textNodes.reduce(0) { $0 + ($1.text?.count ?? 0) }
        let evidence = ContainerEvidence(
            role: container.role,
            frame: RectValue(container.frame),
            visibleTextNodeCount: textNodes.count,
            visibleCharacterCount: characters,
            depth: container.depth
        )
        let areaRatio = (container.frame.width * container.frame.height) / (windowFrame.width * windowFrame.height)
        let rightBias = (container.frame.midX - windowFrame.minX) / windowFrame.width
        let score = Double(textNodes.count) * 25 + Double(min(characters, 5_000)) + areaRatio * 800 + rightBias * 100 + Double(container.depth)
        candidates.append((container, textNodes, evidence, score))
    }
    let sorted = candidates.sorted { left, right in
        if abs(left.3 - right.3) > 0.001 { return left.3 > right.3 }
        if left.0.depth != right.0.depth { return left.0.depth > right.0.depth }
        return left.0.frame.width * left.0.frame.height < right.0.frame.width * right.0.frame.height
    }
    guard let selected = sorted.first else { return nil }
    return (selected.0, selected.1, sorted.prefix(12).map { $0.2 })
}

func expectedTarget(arguments: [String]) throws -> NSRunningApplication {
    guard let pidIndex = arguments.firstIndex(of: "--expected-pid"), pidIndex + 1 < arguments.count,
          let expectedPid = Int32(arguments[pidIndex + 1]),
          let launchIndex = arguments.firstIndex(of: "--expected-launch-date"), launchIndex + 1 < arguments.count else {
        throw WechatAccessibilityError.invalidArguments
    }
    let expectedLaunchDate = arguments[launchIndex + 1]
    guard accessibilityTrusted(prompt: false) else { throw WechatAccessibilityError.accessibilityPermissionRequired }
    guard let target = runningWechatProcesses().first(where: { $0.processIdentifier == expectedPid }) else {
        throw WechatAccessibilityError.targetNotRunning
    }
    guard processLaunchDate(target) == expectedLaunchDate else { throw WechatAccessibilityError.targetProcessChanged }
    guard hasTrustedWechatSignature(target) else { throw WechatAccessibilityError.targetSignatureUntrusted }
    return target
}

func validatedTarget(arguments: [String]) throws -> (NSRunningApplication, AXUIElement, AXUIElement, CGRect) {
    guard accessibilityTrusted(prompt: false) else { throw WechatAccessibilityError.accessibilityPermissionRequired }
    let target = try expectedTarget(arguments: arguments)
    guard let frontmost = NSWorkspace.shared.frontmostApplication,
          frontmost.bundleIdentifier == primaryWechatBundleIdentifier else {
        throw WechatAccessibilityError.targetNotFrontmost
    }
    if target.bundleIdentifier == primaryWechatBundleIdentifier {
        guard frontmost.processIdentifier == target.processIdentifier, target.isActive else {
            throw WechatAccessibilityError.targetNotFrontmost
        }
    } else {
        guard target.bundleURL?.path.hasPrefix(frontmost.bundleURL?.path ?? "__missing_parent_bundle__") == true else {
            throw WechatAccessibilityError.targetProcessChanged
        }
    }
    let applicationElement = AXUIElementCreateApplication(target.processIdentifier)
    guard let focusedValue = copyAttribute(applicationElement, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focusedValue) == AXUIElementGetTypeID() else {
        throw WechatAccessibilityError.focusedWindowUnavailable
    }
    let focusedWindow = focusedValue as! AXUIElement
    guard let focusedWindowFrame = frame(focusedWindow) else { throw WechatAccessibilityError.focusedWindowFrameUnavailable }
    return (target, applicationElement, focusedWindow, focusedWindowFrame)
}

func activateTarget(arguments: [String]) throws -> ActivationOutput {
    let target = try expectedTarget(arguments: arguments)
    let activated = target.activate(options: [.activateIgnoringOtherApps])
    guard activated else { throw WechatAccessibilityError.targetNotFrontmost }
    return ActivationOutput(
        version: "wechat-macos-target-activation-v1",
        bundleIdentifier: target.bundleIdentifier ?? "unknown",
        processIdentifier: target.processIdentifier,
        launchDate: processLaunchDate(target),
        activated: true,
        helperNetworkAccess: false
    )
}

func deniedConnectErrno(address: String, port: UInt16) -> Int32 {
    let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return errno }
    defer { Darwin.close(descriptor) }
    var timeout = timeval(tv_sec: 1, tv_usec: 0)
    withUnsafePointer(to: &timeout) { pointer in
        _ = setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, pointer, socklen_t(MemoryLayout<timeval>.size))
    }
    var socketAddress = sockaddr_in()
    socketAddress.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    socketAddress.sin_family = sa_family_t(AF_INET)
    socketAddress.sin_port = port.bigEndian
    guard inet_pton(AF_INET, address, &socketAddress.sin_addr) == 1 else { return EINVAL }
    let result = withUnsafePointer(to: &socketAddress) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { rebound in
            Darwin.connect(descriptor, rebound, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    return result == 0 ? 0 : errno
}

func runNetworkProbe() -> NetworkProbeOutput {
    let loopbackError = deniedConnectErrno(address: "127.0.0.1", port: 9)
    let externalError = deniedConnectErrno(address: "1.1.1.1", port: 443)
    let deniedCodes = [EPERM, EACCES]
    return NetworkProbeOutput(
        version: "wechat-helper-network-probe-v1",
        loopbackDeniedBySandbox: deniedCodes.contains(loopbackError),
        externalDeniedBySandbox: deniedCodes.contains(externalError),
        loopbackErrno: loopbackError,
        externalErrno: externalError,
        helperNetworkAccess: false
    )
}

func runPreflight(prompt: Bool) -> PreflightOutput {
    let windowCaptureAvailable: Bool
    if #available(macOS 14.0, *) { windowCaptureAvailable = true }
    else { windowCaptureAvailable = false }
    return PreflightOutput(
        version: "wechat-macos-accessibility-v1",
        platform: "darwin",
        accessibilityTrusted: accessibilityTrusted(prompt: prompt),
        screenCaptureTrusted: screenCaptureTrusted(prompt: prompt),
        windowCaptureAvailable: windowCaptureAvailable,
        helperNetworkAccess: false,
        supportedBundleIdentifiers: supportedWechatBundleIdentifiers,
        processes: runningWechatProcesses().map(processIdentity)
    )
}

func runProbe(arguments: [String]) throws -> ProbeOutput {
    let (target, _, focusedWindow, focusedWindowFrame) = try validatedTarget(arguments: arguments)
    let traversed = try traverse(focusedWindow, windowFrame: focusedWindowFrame)
    var roleCounts: [String: Int] = [:]
    for item in traversed { roleCounts[item.role, default: 0] += 1 }
    let readable = traversed.filter { $0.text != nil }
    let selection = selectedConversationContainer(traversed: traversed, windowFrame: focusedWindowFrame)
    return ProbeOutput(
        version: "wechat-macos-accessibility-probe-v1",
        bundleIdentifier: target.bundleIdentifier ?? "unknown",
        processIdentifier: target.processIdentifier,
        launchDate: processLaunchDate(target),
        focusedWindowFrame: RectValue(focusedWindowFrame),
        visitedElementCount: traversed.count,
        roleCounts: roleCounts,
        readableTextNodeCount: readable.count,
        readableCharacterCount: readable.reduce(0) { $0 + ($1.text?.count ?? 0) },
        candidateContainers: selection?.2 ?? [],
        selectedContainer: selection?.2.first,
        helperNetworkAccess: false
    )
}

func runAccessibilityRead(
    target: NSRunningApplication,
    focusedWindow: AXUIElement,
    focusedWindowFrame: CGRect
) throws -> ReadOutput {
    let traversed = try traverse(focusedWindow, windowFrame: focusedWindowFrame)
    guard let selection = selectedConversationContainer(traversed: traversed, windowFrame: focusedWindowFrame) else {
        throw WechatAccessibilityError.visibleConversationContainerUnavailable
    }
    let excludedTop = selection.0.frame.minY + min(72, selection.0.frame.height * 0.10)
    let excludedBottom = selection.0.frame.maxY - min(110, selection.0.frame.height * 0.16)
    var seen = Set<String>()
    var output: [VisibleTextNode] = []
    var bytes = 0
    var truncated = false
    let sortedNodes = selection.1.sorted { left, right in
        if abs(left.frame.minY - right.frame.minY) > 1 { return left.frame.minY < right.frame.minY }
        return left.frame.minX < right.frame.minX
    }
    for node in sortedNodes {
        guard let text = node.text,
              node.frame.midY >= excludedTop,
              node.frame.midY <= excludedBottom else { continue }
        let key = "\(node.role)|\(node.frame.minX.rounded())|\(node.frame.minY.rounded())|\(text)"
        guard seen.insert(key).inserted else { continue }
        let nextBytes = text.utf8.count + (output.isEmpty ? 0 : 1)
        if output.count >= maximumTextNodes || bytes + nextBytes > maximumRawTextBytes {
            truncated = true
            break
        }
        output.append(VisibleTextNode(role: node.role, text: text, frame: RectValue(node.frame)))
        bytes += nextBytes
    }
    guard !output.isEmpty else { throw WechatAccessibilityError.visibleMessageTextUnavailable }
    return ReadOutput(
        version: "wechat-visible-message-read-v1",
        bundleIdentifier: target.bundleIdentifier ?? "unknown",
        processIdentifier: target.processIdentifier,
        launchDate: processLaunchDate(target),
        focusedWindowFrame: RectValue(focusedWindowFrame),
        selectedContainerFrame: RectValue(selection.0.frame),
        nodes: output,
        rawUtf8Bytes: bytes,
        truncated: truncated,
        helperNetworkAccess: false,
        scope: "frontmost-focused-window-visible-message-container",
        captureMethod: "accessibility-tree"
    )
}

@available(macOS 14.0, *)
@MainActor
func captureWechatWindow(
    arguments: [String],
    prevalidatedTarget: (NSRunningApplication, CGRect)? = nil
) async throws -> (
    NSRunningApplication,
    CGRect,
    SCWindow,
    CGImage,
    CGRect,
    CGImage
) {
    let validation = try prevalidatedTarget ?? {
        let (target, _, _, frame) = try validatedTarget(arguments: arguments)
        return (target, frame)
    }()
    let (target, focusedWindowFrame) = validation
    _ = NSApplication.shared
    NSApplication.shared.setActivationPolicy(.prohibited)
    guard screenCaptureTrusted(prompt: false) else { throw WechatAccessibilityError.screenCapturePermissionRequired }
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    } catch {
        throw WechatAccessibilityError.screenCaptureUnavailable
    }
    let targetWindows = content.windows.filter { window in
        guard let owner = window.owningApplication else { return false }
        return owner.bundleIdentifier == primaryWechatBundleIdentifier &&
            owner.processID == target.processIdentifier &&
            window.isOnScreen && window.windowLayer == 0 &&
            window.frame.width >= 500 && window.frame.height >= 400
    }
    let targetWindow = targetWindows.max { left, right in
        let leftIntersection = left.frame.intersection(focusedWindowFrame)
        let rightIntersection = right.frame.intersection(focusedWindowFrame)
        return leftIntersection.width * leftIntersection.height < rightIntersection.width * rightIntersection.height
    }
    guard let targetWindow,
          targetWindow.frame.intersection(focusedWindowFrame).width >= focusedWindowFrame.width * 0.90,
          targetWindow.frame.intersection(focusedWindowFrame).height >= focusedWindowFrame.height * 0.90 else {
        throw WechatAccessibilityError.windowCaptureUnavailable
    }
    let filter = SCContentFilter(desktopIndependentWindow: targetWindow)
    let configuration = SCStreamConfiguration()
    configuration.width = min(4_096, max(1, Int(targetWindow.frame.width * 2)))
    configuration.height = min(4_096, max(1, Int(targetWindow.frame.height * 2)))
    configuration.showsCursor = false
    configuration.capturesAudio = false
    configuration.ignoreShadowsSingleWindow = true
    let image: CGImage
    do {
        image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    } catch {
        throw WechatAccessibilityError.windowCaptureUnavailable
    }
    let pixelWidth = CGFloat(image.width)
    let pixelHeight = CGFloat(image.height)
    let leftInset = floor(pixelWidth * 0.38)
    let topInset = min(floor(pixelHeight * 0.10), 220)
    let bottomInset = min(floor(pixelHeight * 0.16), 300)
    let cropRect = CGRect(
        x: leftInset,
        y: topInset,
        width: pixelWidth - leftInset,
        height: pixelHeight - topInset - bottomInset
    ).integral
    guard cropRect.width >= 300, cropRect.height >= 250,
          let cropped = image.cropping(to: cropRect) else {
        throw WechatAccessibilityError.windowCaptureUnavailable
    }
    return (target, focusedWindowFrame, targetWindow, image, cropRect, cropped)
}

func recognizeTextObservations(_ image: CGImage) throws -> [VNRecognizedTextObservation] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP", "zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    do {
        try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
    } catch {
        throw WechatAccessibilityError.visionRecognitionFailed
    }
    return request.results ?? []
}

@available(macOS 14.0, *)
@MainActor
func runCaptureProbe(arguments: [String]) async throws -> CaptureProbeOutput {
    let (target, focusedWindowFrame, targetWindow, image, cropRect, cropped) = try await captureWechatWindow(arguments: arguments)
    let fullResults = try recognizeTextObservations(image)
    let cropResults = try recognizeTextObservations(cropped)
    return CaptureProbeOutput(
        version: "wechat-macos-window-capture-probe-v1",
        bundleIdentifier: target.bundleIdentifier ?? "unknown",
        processIdentifier: target.processIdentifier,
        focusedWindowFrame: RectValue(focusedWindowFrame),
        capturedWindowFrame: RectValue(targetWindow.frame),
        imageWidth: image.width,
        imageHeight: image.height,
        conversationCrop: RectValue(cropRect),
        fullWindowRecognizedTextNodeCount: fullResults.count,
        conversationRecognizedTextNodeCount: cropResults.count,
        helperNetworkAccess: false
    )
}

@available(macOS 14.0, *)
@MainActor
func captureVisibleWechatWindowWithVision(
    arguments: [String],
    prevalidatedTarget: (NSRunningApplication, CGRect)? = nil
) async throws -> ReadOutput {
    let (target, focusedWindowFrame, targetWindow, image, cropRect, cropped) = try await captureWechatWindow(
        arguments: arguments,
        prevalidatedTarget: prevalidatedTarget
    )
    let observations = try recognizeTextObservations(cropped)
    let pixelWidth = CGFloat(image.width)
    let pixelHeight = CGFloat(image.height)
    let scaleX = targetWindow.frame.width / pixelWidth
    let scaleY = targetWindow.frame.height / pixelHeight
    let logicalCrop = CGRect(
        x: targetWindow.frame.minX + cropRect.minX * scaleX,
        y: targetWindow.frame.minY + cropRect.minY * scaleY,
        width: cropRect.width * scaleX,
        height: cropRect.height * scaleY
    )
    let recognized = observations.compactMap { observation -> (String, Float, CGRect)? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.replacingOccurrences(of: "\u{0000}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, candidate.confidence >= 0.35, text.utf8.count <= maximumRawTextBytes else { return nil }
        let box = observation.boundingBox
        let logicalFrame = CGRect(
            x: logicalCrop.minX + box.minX * logicalCrop.width,
            y: logicalCrop.minY + (1 - box.maxY) * logicalCrop.height,
            width: box.width * logicalCrop.width,
            height: box.height * logicalCrop.height
        )
        return (text, candidate.confidence, logicalFrame)
    }.sorted { left, right in
        if abs(left.2.minY - right.2.minY) > 2 { return left.2.minY < right.2.minY }
        return left.2.minX < right.2.minX
    }
    var nodes: [VisibleTextNode] = []
    var bytes = 0
    var seen = Set<String>()
    var truncated = false
    for item in recognized {
        let key = "\(item.2.minX.rounded())|\(item.2.minY.rounded())|\(item.0)"
        guard seen.insert(key).inserted else { continue }
        let nextBytes = item.0.utf8.count + (nodes.isEmpty ? 0 : 1)
        if nodes.count >= maximumTextNodes || bytes + nextBytes > maximumRawTextBytes {
            truncated = true
            break
        }
        nodes.append(VisibleTextNode(role: "VisionText", text: item.0, frame: RectValue(item.2)))
        bytes += nextBytes
    }
    guard !nodes.isEmpty else { throw WechatAccessibilityError.visibleMessageTextUnavailable }
    return ReadOutput(
        version: "wechat-visible-message-read-v1",
        bundleIdentifier: target.bundleIdentifier ?? "unknown",
        processIdentifier: target.processIdentifier,
        launchDate: processLaunchDate(target),
        focusedWindowFrame: RectValue(focusedWindowFrame),
        selectedContainerFrame: RectValue(logicalCrop),
        nodes: nodes,
        rawUtf8Bytes: bytes,
        truncated: truncated,
        helperNetworkAccess: false,
        scope: "frontmost-focused-wechat-window-visible-conversation-crop",
        captureMethod: "screen-capture-kit-vision-ocr"
    )
}

@MainActor
func runRead(arguments: [String]) async throws -> ReadOutput {
    let (target, _, focusedWindow, focusedWindowFrame) = try validatedTarget(arguments: arguments)
    do {
        return try runAccessibilityRead(
            target: target,
            focusedWindow: focusedWindow,
            focusedWindowFrame: focusedWindowFrame
        )
    } catch WechatAccessibilityError.visibleConversationContainerUnavailable,
            WechatAccessibilityError.visibleMessageTextUnavailable {
        guard arguments.contains("--allow-local-window-ocr") else { throw WechatAccessibilityError.visibleMessageTextUnavailable }
        if #available(macOS 14.0, *) {
            return try await captureVisibleWechatWindowWithVision(
                arguments: arguments,
                prevalidatedTarget: (target, focusedWindowFrame)
            )
        }
        throw WechatAccessibilityError.screenCaptureUnavailable
    }
}

@main
struct WechatAccessibilityHelper {
    @MainActor
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else { throw WechatAccessibilityError.invalidArguments }
            switch command {
            case "--preflight":
                try writeJson(runPreflight(prompt: arguments.contains("--prompt-accessibility")))
            case "--probe":
                try writeJson(try runProbe(arguments: arguments))
            case "--read-visible":
                try writeJson(try await runRead(arguments: arguments))
            case "--read-visible-metadata-only":
                let result = try await runRead(arguments: arguments)
                try writeJson(ReadMetadataOutput(
                    version: result.version,
                    captureMethod: result.captureMethod,
                    nodeCount: result.nodes.count,
                    rawUtf8Bytes: result.rawUtf8Bytes,
                    truncated: result.truncated,
                    scope: result.scope,
                    helperNetworkAccess: result.helperNetworkAccess,
                    focusedWindowFrame: result.focusedWindowFrame,
                    selectedContainerFrame: result.selectedContainerFrame
                ))
            case "--activate-target":
                try writeJson(try activateTarget(arguments: arguments))
            case "--network-probe":
                try writeJson(runNetworkProbe())
            case "--capture-probe":
                if #available(macOS 14.0, *) {
                    try writeJson(try await runCaptureProbe(arguments: arguments))
                } else {
                    throw WechatAccessibilityError.screenCaptureUnavailable
                }
            default:
                throw WechatAccessibilityError.invalidArguments
            }
        } catch {
            let code: String
            switch error {
            case WechatAccessibilityError.invalidArguments: code = "INVALID_ARGUMENTS"
            case WechatAccessibilityError.accessibilityPermissionRequired: code = "MACOS_ACCESSIBILITY_PERMISSION_REQUIRED"
            case WechatAccessibilityError.targetNotRunning: code = "WECHAT_NOT_RUNNING"
            case WechatAccessibilityError.targetNotFrontmost: code = "WECHAT_NOT_FRONTMOST"
            case WechatAccessibilityError.targetProcessChanged: code = "WECHAT_PROCESS_CHANGED"
            case WechatAccessibilityError.focusedWindowUnavailable: code = "WECHAT_FOCUSED_WINDOW_UNAVAILABLE"
            case WechatAccessibilityError.focusedWindowFrameUnavailable: code = "WECHAT_FOCUSED_WINDOW_FRAME_UNAVAILABLE"
            case WechatAccessibilityError.visibleConversationContainerUnavailable: code = "WECHAT_VISIBLE_CONVERSATION_CONTAINER_UNAVAILABLE"
            case WechatAccessibilityError.visibleMessageTextUnavailable: code = "WECHAT_VISIBLE_MESSAGE_TEXT_UNAVAILABLE"
            case WechatAccessibilityError.traversalLimitExceeded: code = "WECHAT_AX_TRAVERSAL_LIMIT_EXCEEDED"
            case WechatAccessibilityError.screenCapturePermissionRequired: code = "MACOS_SCREEN_CAPTURE_PERMISSION_REQUIRED"
            case WechatAccessibilityError.screenCaptureUnavailable: code = "MACOS_SCREEN_CAPTURE_UNAVAILABLE"
            case WechatAccessibilityError.windowCaptureUnavailable: code = "WECHAT_WINDOW_CAPTURE_UNAVAILABLE"
            case WechatAccessibilityError.visionRecognitionFailed: code = "WECHAT_VISION_OCR_FAILED"
            case WechatAccessibilityError.targetSignatureUntrusted: code = "WECHAT_TARGET_SIGNATURE_UNTRUSTED"
            default: code = "WECHAT_ACCESSIBILITY_FAILED"
            }
            try? writeJson(ErrorOutput(errorCode: code, message: "The visible WeChat conversation could not be read within the approved macOS accessibility scope."))
            Foundation.exit(1)
        }
    }
}
