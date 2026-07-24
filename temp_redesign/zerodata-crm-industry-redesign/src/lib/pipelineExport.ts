import * as XLSX from 'xlsx';
import { db } from './db';

export async function exportPipelineToExcel(userId: string, isAdmin: boolean) {
  let leads;
  
  if (isAdmin) {
    leads = await db.leads.toArray();
  } else {
    leads = await db.leads.where('assigned_to').equals(userId).toArray();
  }

  const exportData = leads.map(lead => ({
    'Lead ID': lead.lead_id,
    'Business Name': lead.business_name,
    'Contact Person': lead.contact_person,
    'Phone': lead.phone,
    'Segment': lead.segment_type,
    'Status': lead.status,
    'Loss Reason': lead.loss_reason || '',
    'Area': lead.area || '',
    'Assigned To': lead.assigned_to,
    'Created At': lead.created_at ? new Date(lead.created_at).toISOString().slice(0, 19).replace('T', ' ') : '',
    'Lead Source': lead.lead_source || '',
    'Lead Source Other': lead.lead_source_other || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Pipeline');

  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fileName = `Pipeline_Export_${dateStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
