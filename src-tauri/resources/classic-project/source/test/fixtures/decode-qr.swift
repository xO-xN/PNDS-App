import Foundation
import Vision
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
try VNImageRequestHandler(url: URL(fileURLWithPath: CommandLine.arguments[1])).perform([request])
guard let decoded = request.results?.first?.payloadStringValue else { fatalError("QR did not decode") }
print(decoded)
