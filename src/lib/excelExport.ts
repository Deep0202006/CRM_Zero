import * as XLSX from 'xlsx';
import { db } from './db';

const formatIsoDate = (dateString?: string | null) => {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toISOString().slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:mm
  } catch (e) {
    return dateString;
  }
};

const triggerDownload = (workbook: XLSX.WorkBook, prefix: string) => {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fileName = `${prefix}_${dateStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};

// 1. Agent Self-Service Downloads

export async function exportSales(userId: string) {
  const leads = await db.leads.where('assigned_to').equals(userId).toArray();
  const data = leads.map(l => ({
    'Lead ID': l.lead_id,
    'Business Name': l.business_name,
    'Contact Person': l.contact_person,
    'Phone': l.phone,
    'Segment': l.segment_type,
    'Status': l.status,
    'Loss Reason': l.loss_reason || '',
    'Created At': formatIsoDate(l.created_at),
    'Onboarded At': formatIsoDate(l.onboarded_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Sales');
  triggerDownload(wb, 'My_Sales_Export');
}

export async function exportSupport(userId: string) {
  const queries = await db.client_queries.where('assigned_to').equals(userId).toArray();
  const data = queries.map(q => ({
    'Query ID': q.query_id,
    'Lead ID': q.lead_id,
    'Client Problem': q.client_problem,
    'Status': q.problem_status,
    'Resolution Notes': q.resolution_notes || '',
    'Created At': formatIsoDate(q.created_at),
    'Resolved At': formatIsoDate(q.resolved_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Support');
  triggerDownload(wb, 'My_Support_Export');
}

export async function exportMappings(userId: string) {
  const mappings = await db.mapping_requests.where('mapped_by').equals(userId).toArray();
  const data = mappings.map(m => ({
    'Request ID': m.request_id,
    'Distributor Lead ID': m.distributor_lead_id,
    'Retailer Lead ID': m.retailer_lead_id,
    'Status': m.status,
    'Notes': m.notes || '',
    'Created At': formatIsoDate(m.created_at),
    'Completed At': formatIsoDate(m.completed_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Mappings');
  triggerDownload(wb, 'My_Mappings_Export');
}

// 2. Unified Administrative Master Export Panels

export async function exportMasterSales() {
  const leads = await db.leads.toArray();
  const data = leads.map(l => ({
    'Lead ID': l.lead_id,
    'Business Name': l.business_name,
    'Contact Person': l.contact_person,
    'Phone': l.phone,
    'Segment': l.segment_type,
    'Status': l.status,
    'Loss Reason': l.loss_reason || '',
    'Assigned To': l.assigned_to || '',
    'Created At': formatIsoDate(l.created_at),
    'Onboarded At': formatIsoDate(l.onboarded_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Sales');
  triggerDownload(wb, 'Master_Sales_Export');
}

export async function exportMasterSupport() {
  const queries = await db.client_queries.toArray();
  const data = queries.map(q => ({
    'Query ID': q.query_id,
    'Lead ID': q.lead_id,
    'Client Problem': q.client_problem,
    'Status': q.problem_status,
    'Assigned To': q.assigned_to || '',
    'Resolution Notes': q.resolution_notes || '',
    'Created At': formatIsoDate(q.created_at),
    'Resolved At': formatIsoDate(q.resolved_at),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Support');
  triggerDownload(wb, 'Master_Support_Export');
}

export async function exportMasterMappings() {
  const requests = await db.mapping_requests.toArray();
  // Fetch users and leads for displaying names in master export
  const usersArray = await db.users.toArray();
  const leadsArray = await db.leads.toArray();
  
  const userMap = new Map(usersArray.map(u => [u.user_id, u.name]));
  const leadMap = new Map(leadsArray.map(l => [l.lead_id, l.business_name]));

  const data = requests.map(r => ({
    'Request ID': r.request_id,
    'Distributor Name': (r.distributor_lead_id ? leadMap.get(r.distributor_lead_id) : r.distributor_name_unregistered) || r.distributor_lead_id || r.distributor_name_unregistered || '',
    'Retailer Name': (r.retailer_lead_id ? leadMap.get(r.retailer_lead_id) : r.retailer_name_unregistered) || r.retailer_lead_id || r.retailer_name_unregistered || '',
    'Mapped By Username': r.mapped_by ? (userMap.get(r.mapped_by) || r.mapped_by) : '',
    'Status': r.status,
    'Notes': r.notes || '',
    'Created At': formatIsoDate(r.created_at),
    'Completed At': formatIsoDate(r.completed_at),
  }));
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Master Mappings');
  triggerDownload(wb, 'Master_Mappings_Export');
}
