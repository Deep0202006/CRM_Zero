import imageCompression from "browser-image-compression";
import { compressSelfie } from "../imageCompression";
import { STORAGE_BUDGET } from "../storageBudget";

jest.mock("browser-image-compression", () => jest.fn());

const mockedCompression = imageCompression as jest.MockedFunction<typeof imageCompression>;

describe("visit evidence compression", () => {
  it("enforces the configured byte and dimension targets", async () => {
    const original = new File([new Uint8Array(900_000)], "original.jpg", { type: "image/jpeg" });
    const compressed = new File([new Uint8Array(300_000)], "compressed.jpg", { type: "image/jpeg" });
    mockedCompression.mockResolvedValueOnce(compressed);

    await expect(compressSelfie(original)).resolves.toBe(compressed);
    expect(mockedCompression).toHaveBeenCalledWith(original, expect.objectContaining({
      maxWidthOrHeight: STORAGE_BUDGET.visitImageMaxDimension,
      maxSizeMB: STORAGE_BUDGET.visitImageMaxBytes / (1024 * 1024),
      fileType: "image/jpeg",
    }));
    expect(compressed.size).toBeLessThanOrEqual(STORAGE_BUDGET.visitImageMaxBytes * 1.1);
  });

  it("never falls back to retaining the full-resolution original", async () => {
    mockedCompression.mockRejectedValueOnce(new Error("decoder failed"));
    const original = new File([new Uint8Array(900_000)], "original.jpg", { type: "image/jpeg" });
    await expect(compressSelfie(original)).rejects.toThrow("capture the evidence again");
  });
});
