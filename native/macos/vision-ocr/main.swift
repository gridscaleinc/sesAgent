import AppKit
import Foundation
import NaturalLanguage
import PDFKit
import Vision

struct BoundingBox: Codable {
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
}

struct OcrTextBlock: Codable {
    let text: String
    let confidence: Float
    let boundingBox: BoundingBox
}

struct BarcodeRegion: Codable {
    let payload: String?
    let symbology: String
    let boundingBox: BoundingBox
}

struct OcrPage: Codable {
    let page: Int
    let width: Double
    let height: Double
    let textBlocks: [OcrTextBlock]
    let faceRegions: [BoundingBox]
    let barcodeRegions: [BarcodeRegion]
}

struct OcrCoverage: Codable {
    let textRecognition: String
    let faceDetection: String
    let qrCodeDetection: String
    let signatureDetection: String
}

struct OcrOutput: Codable {
    let version: String
    let engine: String
    let pages: [OcrPage]
    let warnings: [String]
    let coverage: OcrCoverage
    let networkAccess: Bool
}

struct ErrorOutput: Codable {
    let errorCode: String
    let message: String
}

struct NameEntity: Codable {
    let text: String
    let startUtf16: Int
    let endUtf16: Int
    let tag: String
}

struct NameDetectionOutput: Codable {
    let version: String
    let engine: String
    let entities: [NameEntity]
    let networkAccess: Bool
    let requiresHumanConfirmation: Bool
}

enum OcrError: Error {
    case invalidArguments
    case inputTooLarge
    case invalidPdf
    case pageLimit
    case renderFailed(Int)
}

func writeJson<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func renderPage(_ page: PDFPage, pageNumber: Int) throws -> (CGImage, CGSize) {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else { throw OcrError.renderFailed(pageNumber) }
    let longestSide = max(bounds.width, bounds.height)
    let scale = min(3.0, max(1.5, 2600.0 / longestSide))
    let requestedSize = NSSize(width: bounds.width * scale, height: bounds.height * scale)
    let thumbnail = page.thumbnail(of: requestedSize, for: .mediaBox)
    var proposedRect = NSRect(origin: .zero, size: thumbnail.size)
    guard let image = thumbnail.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
        throw OcrError.renderFailed(pageNumber)
    }
    return (image, bounds.size)
}

func recognizePage(_ page: PDFPage, pageNumber: Int) throws -> (OcrPage, [String]) {
    let (image, sourceSize) = try renderPage(page, pageNumber: pageNumber)
    let textRequest = VNRecognizeTextRequest()
    textRequest.recognitionLevel = .accurate
    textRequest.recognitionLanguages = ["ja-JP", "en-US"]
    textRequest.usesLanguageCorrection = true

    let faceRequest = VNDetectFaceRectanglesRequest()
    let barcodeRequest = VNDetectBarcodesRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    try handler.perform([textRequest, faceRequest, barcodeRequest])

    let textBlocks = (textRequest.results ?? []).compactMap { observation -> OcrTextBlock? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return OcrTextBlock(
            text: candidate.string,
            confidence: candidate.confidence,
            boundingBox: BoundingBox(observation.boundingBox)
        )
    }.sorted {
        if abs($0.boundingBox.y - $1.boundingBox.y) > 0.015 {
            return $0.boundingBox.y > $1.boundingBox.y
        }
        return $0.boundingBox.x < $1.boundingBox.x
    }

    let faces = (faceRequest.results ?? []).map { BoundingBox($0.boundingBox) }
    let barcodes = (barcodeRequest.results ?? []).map {
        BarcodeRegion(
            payload: $0.payloadStringValue,
            symbology: String(describing: $0.symbology),
            boundingBox: BoundingBox($0.boundingBox)
        )
    }
    var warnings: [String] = []
    if textBlocks.isEmpty { warnings.append("PAGE_OCR_EMPTY:\(pageNumber)") }
    if textBlocks.contains(where: { $0.confidence < 0.45 }) { warnings.append("PAGE_OCR_LOW_CONFIDENCE:\(pageNumber)") }
    if !faces.isEmpty { warnings.append("FACE_REGION_DETECTED:\(pageNumber)") }
    if !barcodes.isEmpty { warnings.append("BARCODE_REGION_DETECTED:\(pageNumber)") }

    return (
        OcrPage(
            page: pageNumber,
            width: sourceSize.width,
            height: sourceSize.height,
            textBlocks: textBlocks,
            faceRegions: faces,
            barcodeRegions: barcodes
        ),
        warnings
    )
}

func runOcr() throws -> OcrOutput {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 25 * 1024 * 1024 else { throw OcrError.inputTooLarge }
    guard let document = PDFDocument(data: input) else { throw OcrError.invalidPdf }
    guard document.pageCount <= 100 else { throw OcrError.pageLimit }

    var pages: [OcrPage] = []
    var warnings = ["SIGNATURE_DETECTION_REQUIRES_HUMAN_REVIEW"]
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else { throw OcrError.renderFailed(index + 1) }
        let result = try recognizePage(page, pageNumber: index + 1)
        pages.append(result.0)
        warnings.append(contentsOf: result.1)
    }
    return OcrOutput(
        version: "vision-ocr-v1",
        engine: "apple-vision",
        pages: pages,
        warnings: warnings,
        coverage: OcrCoverage(
            textRecognition: "ja-JP+en-US-accurate",
            faceDetection: "vision-face-rectangles",
            qrCodeDetection: "vision-barcodes",
            signatureDetection: "human-review-required"
        ),
        networkAccess: false
    )
}

func runNameDetection() throws -> NameDetectionOutput {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 2 * 1024 * 1024, let text = String(data: input, encoding: .utf8) else {
        throw OcrError.inputTooLarge
    }
    let tagger = NLTagger(tagSchemes: [.nameType])
    tagger.string = text
    tagger.setLanguage(.english, range: text.startIndex..<text.endIndex)
    var entities: [NameEntity] = []
    let options: NLTagger.Options = [.omitWhitespace, .omitPunctuation, .joinNames]
    tagger.enumerateTags(
        in: text.startIndex..<text.endIndex,
        unit: .word,
        scheme: .nameType,
        options: options
    ) { tag, range in
        guard tag == .personalName else { return true }
        let value = String(text[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 2 else { return true }
        let nsRange = NSRange(range, in: text)
        entities.append(
            NameEntity(
                text: value,
                startUtf16: nsRange.location,
                endUtf16: nsRange.location + nsRange.length,
                tag: "personalName"
            )
        )
        return true
    }
    return NameDetectionOutput(
        version: "apple-nl-ner-v1",
        engine: "apple-natural-language",
        entities: entities,
        networkAccess: false,
        requiresHumanConfirmation: true
    )
}

do {
    guard CommandLine.arguments.count == 2 else { throw OcrError.invalidArguments }
    switch CommandLine.arguments[1] {
    case "--pdf": try writeJson(try runOcr())
    case "--detect-names": try writeJson(try runNameDetection())
    default: throw OcrError.invalidArguments
    }
} catch {
    let code: String
    switch error {
    case OcrError.invalidArguments: code = "INVALID_ARGUMENTS"
    case OcrError.inputTooLarge: code = "INPUT_TOO_LARGE"
    case OcrError.invalidPdf: code = "INVALID_PDF"
    case OcrError.pageLimit: code = "PAGE_LIMIT_EXCEEDED"
    case OcrError.renderFailed: code = "PAGE_RENDER_FAILED"
    default: code = "VISION_OCR_FAILED"
    }
    try? writeJson(ErrorOutput(errorCode: code, message: "Local Vision OCR could not process the document."))
    exit(1)
}
