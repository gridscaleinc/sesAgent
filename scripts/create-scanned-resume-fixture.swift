import CoreGraphics
import CoreText
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: create-scanned-resume-fixture.swift OUTPUT.pdf\n", stderr)
    exit(64)
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let pixelWidth = 1240
let pixelHeight = 1754

let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let bitmapContext = CGContext(
    data: nil,
    width: pixelWidth,
    height: pixelHeight,
    bitsPerComponent: 8,
    bytesPerRow: pixelWidth * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("Unable to create bitmap fixture.\n", stderr)
    exit(1)
}

bitmapContext.setFillColor(CGColor(gray: 1, alpha: 1))
bitmapContext.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))

func drawText(_ text: String, x: CGFloat, y: CGFloat, size: CGFloat, bold: Bool = false) {
    let fontName = bold ? "HiraginoSans-W6" : "HiraginoSans-W3"
    let font = CTFontCreateWithName(fontName as CFString, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(rawValue: kCTFontAttributeName as String): font,
        NSAttributedString.Key(rawValue: kCTForegroundColorAttributeName as String): CGColor(gray: 0.15, alpha: 1)
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    bitmapContext.textPosition = CGPoint(x: x, y: y)
    CTLineDraw(line, bitmapContext)
}

drawText("スキルシート（合成テストデータ）", x: 82, y: 1590, size: 44, bold: true)

let lines = [
    "候補者名: 検証 太郎",
    "電話: 090-1234-5678",
    "メール: taro.fixture@example.test",
    "住所: 東京都千代田区テスト1-2-3",
    "役割: SE",
    "スキル: Java / Spring Boot / AWS / PostgreSQL",
    "経験: 7年",
    "希望単価: 80〜90万円/月",
    "日本語: N2",
    "勤務形態: フルリモート",
    "稼働時期: 8月から参画可能"
]

for (index, line) in lines.enumerated() {
    drawText(line, x: 92, y: CGFloat(1475 - index * 105), size: 29)
}

guard let image = bitmapContext.makeImage() else {
    fputs("Unable to create fixture image.\n", stderr)
    exit(1)
}

var pageBox = CGRect(x: 0, y: 0, width: 595, height: 842)
guard
    let consumer = CGDataConsumer(url: outputURL as CFURL),
    let context = CGContext(consumer: consumer, mediaBox: &pageBox, nil)
else {
    fputs("Unable to create PDF fixture.\n", stderr)
    exit(1)
}

context.beginPDFPage(nil)
context.draw(image, in: pageBox)
context.endPDFPage()
context.closePDF()
print(outputURL.path)
