// Project-owned QR HTTP route. The caller resolves the full performer URL.
const QRCode = require("qrcode");

function validPerformerUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || !value) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function qrHandler(url, { width = 480, margin = 1, errorCorrectionLevel = "M", format = "png" } = {}) {
  if (!Number.isInteger(width) || width < 1 || width > 4096 || !Number.isInteger(margin) || margin < 0 || margin > 32 || !["L", "M", "Q", "H"].includes(errorCorrectionLevel) || !["png", "svg"].includes(format)) {
    throw new TypeError("Invalid QR output options");
  }
  return async (request, response) => {
    if (!validPerformerUrl(url)) {
      response.status(400).json({ error: "invalid-performer-url" });
      return;
    }
    try {
      const options = { width, margin, errorCorrectionLevel };
      const output = format === "svg" ? await QRCode.toString(url, { ...options, type: "svg" }) : await QRCode.toBuffer(url, { ...options, type: "png" });
      response.type(format === "svg" ? "image/svg+xml" : "image/png").send(output);
    } catch {
      // No URL or third-party error is logged (URLs can contain private query data).
      response.status(500).json({ error: "qr-generation-failed" });
    }
  };
}

module.exports = { qrHandler };
