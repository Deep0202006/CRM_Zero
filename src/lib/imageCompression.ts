import imageCompression from "browser-image-compression";

/**
 * Compresses an image file (e.g. attendance check-in selfie) to fit within a target limit of ~200KB.
 * Reduces dimension and quality appropriately while running in a background Web Worker.
 */
export async function compressSelfie(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.2,            // Target size: 200KB (0.2 MB)
    maxWidthOrHeight: 800,      // Max width/height to preserve mobile rendering quality
    useWebWorker: true,        // Offload work to avoid freezing the main UI thread
    fileType: "image/jpeg"     // Standardize format
  };

  try {
    const compressedFile = await imageCompression(file, options);
    console.log(`Image compressed from ${(file.size / 1024).toFixed(2)}KB to ${(compressedFile.size / 1024).toFixed(2)}KB`);
    return compressedFile;
  } catch (error) {
    console.error("Image compression failed. Falling back to original image:", error);
    return file; // Fallback to original file if compression fails
  }
}
