import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import * as xlsx from "xlsx";
import { loadVisitReport, visitReportFiltersSchema, type VisitReportRow } from "@/lib/fieldVisits/serverReport";

export const dynamic = "force-dynamic";

function safeCell(value: unknown): string | number {
  if (typeof value === "number") return value;
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!url || !anonKey) return NextResponse.json({ code: "SUPABASE_NOT_CONFIGURED" }, { status: 500 });
  if (!token) return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const base = visitReportFiltersSchema.safeParse({
    from: params.get("from"), to: params.get("to"),
    representative: params.get("representative") || null,
    segment: params.get("segment") || null,
    outcomes: params.getAll("outcome"), search: params.get("search") || null,
    page: 1, pageSize: 200, sortDesc: true,
  });
  if (!base.success) return NextResponse.json({ code: "INVALID_VISIT_FILTERS" }, { status: 400 });

  try {
    const rows: VisitReportRow[] = [];
    let page = 1;
    let totals = { total: 0, retailer: 0, distributor: 0 };
    do {
      const report = await loadVisitReport(client, { ...base.data, page });
      rows.push(...report.rows);
      totals = report.totals;
      page += 1;
    } while (rows.length < totals.total);

    const register = rows.map((visit) => ({
      "Visit ID": safeCell(visit.visit_id),
      "Visit Date": safeCell(visit.visit_date),
      "Check-in Time": safeCell(visit.check_in_time),
      "Representative": safeCell(visit.representative_name),
      "Representative Email": safeCell(visit.representative_email),
      "Business": safeCell(visit.business_name ?? visit.lead_id),
      "Contact Person": safeCell(visit.contact_person),
      "Phone": safeCell(visit.phone),
      "Segment": safeCell(visit.segment_type),
      "Outcome": safeCell(visit.visit_outcome),
      "Person Met": safeCell(visit.person_met),
      "Notes": safeCell(visit.visit_notes),
      "Follow-up Date": safeCell(visit.follow_up_date),
      "Latitude": safeCell(visit.check_in_lat),
      "Longitude": safeCell(visit.check_in_lng),
      "Accuracy (m)": safeCell(visit.location_accuracy_m),
      "Location Quality": safeCell(visit.location_quality),
      "Selfie Captured": safeCell(visit.selfie_captured_at),
    }));
    const representatives = new Map<string, { name: string; total: number; retailer: number; distributor: number }>();
    for (const visit of rows) {
      const summary = representatives.get(visit.user_id) ?? {
        name: visit.representative_name, total: 0, retailer: 0, distributor: 0,
      };
      summary.total += 1;
      if (visit.segment_type === "Retailer") summary.retailer += 1;
      if (visit.segment_type === "Distributor") summary.distributor += 1;
      representatives.set(visit.user_id, summary);
    }
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { Metric: "Total visits", Value: totals.total },
      { Metric: "Retailer visits", Value: totals.retailer },
      { Metric: "Distributor visits", Value: totals.distributor },
      { Metric: "From date", Value: base.data.from },
      { Metric: "To date", Value: base.data.to },
    ]), "Summary");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(register), "Visit Register");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(
      [...representatives.values()].map((entry) => ({
        Representative: safeCell(entry.name), "Total Visits": entry.total,
        Retailer: entry.retailer, Distributor: entry.distributor,
      })),
    ), "Representative Summary");
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
      { Field: "Visit ID", Definition: "Stable confirmed visit identifier" },
      { Field: "Visit Date", Definition: "Asia/Kolkata business date" },
      { Field: "Accuracy (m)", Definition: "Reported geolocation accuracy in metres" },
      { Field: "Selfie Captured", Definition: "Evidence capture timestamp; image is not exported" },
    ]), "Data Dictionary");
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Disposition": `attachment; filename="FieldVisits_${base.data.from}_${base.data.to}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "VISIT_EXPORT_FAILED";
    return NextResponse.json({ code, message: "Visit export failed." }, { status: code === "42501" ? 403 : 500 });
  }
}
