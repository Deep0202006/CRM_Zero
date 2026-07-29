import imageCompression from "browser-image-compression";
import { MIB, STORAGE_BUDGET } from "./storageBudget";

/**
 * Compresses evidence before it can enter durable local storage.
 * Reduces dimension and quality appropriately while running in a background Web Worker.
 */
export async function compressSelfie(file: File): Promise<File> {
  const options = {
    maxSizeMB: STORAGE_BUDGET.visitImageMaxBytes / MIB,
    maxWidthOrHeight: STORAGE_BUDGET.visitImageMaxDimension,
    useWebWorker: true,        // Offload work to avoid freezing the main UI thread
    fileType: "image/jpeg"     // Standardize format
  };

  try {
    const compressedFile = await imageCompression(file, options);
    if (compressedFile.size > STORAGE_BUDGET.visitImageMaxBytes * 1.1) {
      throw new Error("Compressed visit evidence exceeds the local storage target.");
    }
    return compressedFile;
  } catch (error) {
    console.error("Image compression failed; the original was not retained.", error instanceof Error ? error.message : "compression error");
    throw new Error("Image compression failed. Please capture the evidence again.");
  }
}
