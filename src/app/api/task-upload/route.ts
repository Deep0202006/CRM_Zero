import { NextRequest, NextResponse } from "next/server";
import * as xlsx from "xlsx";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse the Excel file
    const workbook = xlsx.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert sheet to JSON
    // Expected headers (or similar): 'Legal Name', 'Username', 'Phone Number', 'City'
    const rawData = xlsx.utils.sheet_to_json<any>(sheet);

    if (!rawData || rawData.length === 0) {
      return NextResponse.json({ error: "Excel file is empty" }, { status: 400 });
    }

    // Normalize keys to standard format
    const normalizedData = rawData.map((row) => {
      // Very basic normalization to find the right keys
      const keys = Object.keys(row);
      const getVal = (possibleKeys: string[]) => {
        const key = keys.find(k => possibleKeys.some(pk => k.toLowerCase().includes(pk)));
        return key ? String(row[key]) : "";
      };

      return {
        target_legal_name: getVal(["name", "legal name", "business"]),
        target_username: getVal(["username", "user", "id"]),
        target_phone_number: getVal(["phone", "mobile", "contact"]),
        city: getVal(["city", "location", "area"]),
      };
    });

    // Filter out rows without a city or name
    const validData = normalizedData.filter(row => row.city && row.target_legal_name);

    // Extract unique cities
    const uniqueCities = Array.from(new Set(validData.map((row) => row.city))).sort();

    // Generate a file hash to prevent duplicate multi-processing
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    return NextResponse.json({
      success: true,
      filename: file.name,
      hash,
      cities: uniqueCities,
      rows: validData,
      totalParsed: validData.length
    });

  } catch (error: any) {
    console.error("Error processing Excel file:", error);
    return NextResponse.json(
      { error: "Failed to process Excel file", details: error.message },
      { status: 500 }
    );
  }
}
