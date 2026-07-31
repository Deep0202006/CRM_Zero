import imageCompression from "browser-image-compression";

/**
 * Compresses image evidence to a practical mobile storage budget.
 */
export async function compressSelfie(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.34,           // Target size: approximately 350KB
    maxWidthOrHeight: 1280,
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
